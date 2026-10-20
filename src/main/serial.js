'use strict';

// 연결된 시리얼 포트를 전부 자동으로 열고 줄 단위로 읽는다.
// 포트 이름(COM3, /dev/cu.usbmodem…)은 신경 쓰지 않고 줄 앞부분(P1/P2/START)으로만 구분한다.

const { EventEmitter } = require('events');
const { SerialPort, ReadlineParser } = require('serialport');

const BAUD_RATE = 9600;
const SCAN_INTERVAL_MS = 2000;
const ALIVE_MS = 2000; // 최근 2초 안에 줄이 들어왔으면 "연결됨"

const LINE_SAMPLE = /^(P1|P2)\s+(-?\d+)$/;
const LINE_START = /^START$/;

/** 형식에 맞지 않으면 null */
function parseLine(line) {
  const s = String(line).replace(/\r/g, '').trim().toUpperCase();
  let m = LINE_SAMPLE.exec(s);
  if (m) return { type: 'sample', player: m[1].toLowerCase(), value: Math.max(0, parseInt(m[2], 10)) };
  if (LINE_START.test(s)) return { type: 'start' };
  return null;
}

function normalizePath(p) {
  // macOS: tty.* 는 열 때 막힐 수 있어 cu.* 로 연다
  if (process.platform === 'darwin') return p.replace(/^\/dev\/tty\./, '/dev/cu.');
  return p;
}

// 아두이노는 USB 장치라 vendorId 가 있다. 블루투스 이어폰·내장 COM1 같은 포트는 열지 않는다.
const USB_NAME = /usbmodem|usbserial|wchusbserial|SLAB_USBtoUART|ttyACM|ttyUSB/i;
function shouldSkip(info, p) {
  if (/bluetooth|debug-console|wlan/i.test(p)) return true;
  return !info.vendorId && !USB_NAME.test(p);
}

class SerialManager extends EventEmitter {
  constructor() {
    super();
    this.ports = new Map(); // path -> SerialPort
    this.seen = { p1: { t: 0, path: null }, p2: { t: 0, path: null } };
    this.timer = null;
    this.scanning = false;
  }

  start() {
    this.scan();
    this.timer = setInterval(() => this.scan(), SCAN_INTERVAL_MS);
  }

  stopAll() {
    clearInterval(this.timer);
    this.timer = null;
    for (const port of this.ports.values()) this.closePort(port);
    this.ports.clear();
  }

  /** 관리자 화면의 "포트 다시 연결" */
  reconnect() {
    for (const port of this.ports.values()) this.closePort(port);
    this.ports.clear();
    setTimeout(() => this.scan(), 500);
  }

  async scan() {
    if (this.scanning) return;
    this.scanning = true;
    try {
      const list = await SerialPort.list();
      for (const info of list) {
        const p = normalizePath(info.path);
        if (shouldSkip(info, p) || this.ports.has(p)) continue;
        this.open(p);
      }
    } catch (err) {
      console.error('[serial] 포트 목록 실패:', err.message);
    } finally {
      this.scanning = false;
    }
  }

  open(path) {
    const port = new SerialPort({ path, baudRate: BAUD_RATE, autoOpen: false });
    this.ports.set(path, port);
    const forget = () => {
      if (this.ports.get(path) === port) this.ports.delete(path);
    };
    port.open((err) => {
      if (err) {
        // 다른 프로그램이 쓰는 중이거나 사라진 포트. 다음 검색 때 다시 시도한다.
        forget();
        return;
      }
      console.log('[serial] 열림:', path);
    });
    const parser = port.pipe(new ReadlineParser({ delimiter: '\n' }));
    parser.on('data', (line) => this.handleLine(line, path));
    // 케이블이 빠지면 close 이벤트가 오고, 다시 꽂히면 다음 검색에서 다시 열린다
    port.on('close', () => {
      console.log('[serial] 닫힘:', path);
      forget();
    });
    port.on('error', (err) => {
      console.error('[serial] 오류:', path, err.message);
      forget();
      this.closePort(port);
    });
  }

  closePort(port) {
    try {
      if (port.isOpen) port.close(() => {});
    } catch (_) { /* ignore */ }
  }

  handleLine(line, path) {
    const msg = parseLine(line);
    if (!msg) return;
    if (msg.type === 'start') {
      this.emit('start');
    } else {
      this.markSeen(msg.player, path);
      this.emit('sample', msg.player, msg.value);
    }
  }

  markSeen(player, path) {
    this.seen[player] = { t: Date.now(), path };
  }

  status(now) {
    const one = (k) => ({ connected: now - this.seen[k].t < ALIVE_MS, path: this.seen[k].path });
    return { p1: one('p1'), p2: one('p2'), open: [...this.ports.keys()].sort() };
  }
}

module.exports = { SerialManager, parseLine };
