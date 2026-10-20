# raibitScoreboard — 근전도 2인 대결 스코어보드

두 선수의 전완근에 단 근전도(EMG) 센서 값을 아두이노 2대(USB 시리얼)로 받아, 5초 동안 누가 더 세게 근육을 수축하는지 겨루고 명예의 전당(상위 5개)을 관리하는 Electron 앱입니다.
Windows / macOS 둘 다 지원하고, 인터넷 없이 동작합니다(Do Hyeon 글꼴 포함).

> **현재 상태**: 아래 내용은 지금 코드(v1.2.0)가 그대로 동작하는 방식이고, `npm start`는 실제 아두이노 2대가 연결돼 있다고 가정합니다. 하드웨어가 아직 준비 안 됐거나 동작을 확인하려면 `npm run sim`(근전도 신호 없이 시뮬레이션)으로 실행하세요. SpikerBox 기반 1인 기록 모드(v2.0.0)로 바뀌는 중이며, 자세한 내용은 `CLAUDE.md`와 `PLAN.md`를 참고하세요.

## 실행

```bash
npm install
npm start          # 실제 아두이노와 함께 (전체화면 kiosk)
npm run sim        # 아두이노 없이 시뮬레이션 (= electron . --sim)
npm test           # 경기 로직·명예의 전당·저장·줄 파싱 단위 테스트
```

### 전체화면 / 창 모드

- `F11` 키(macOS는 `Control + Cmd + F`도 가능) 또는 관리자 화면 오른쪽 위 "창 모드로 보기 / 전체화면으로 보기" 버튼으로 바꿉니다.
- 마지막으로 고른 방식이 저장돼서 다음에 켤 때도 그대로 시작합니다(`settings.json`의 `"fullscreen"`).
- 실행 인자로 한 번만 정할 수도 있습니다: `--windowed`(창 모드), `--fullscreen`(전체화면).

```bash
npx electron . --sim --windowed
```

- 화면은 1440×900 기준 디자인을 비율 유지한 채 꽉 차게 확대·축소합니다(남는 부분은 배경색).
- 종료: macOS `Cmd+Q`, Windows `Alt+F4`, 또는 관리자 화면의 "앱 종료".
- 앱은 하나만 실행됩니다(두 개가 시리얼 포트를 서로 뺏지 않게).

## 빌드

```bash
npm run build:win   # dist/ 에 Windows용 portable .exe 와 설치형 setup .exe
npm run build:mac   # dist/ 에 macOS용 .dmg (Apple Silicon / Intel 각각)
```

- 두 빌드 모두 macOS에서 만들 수 있습니다. Windows에서는 `build:win`만 됩니다.
- serialport는 미리 빌드된 바이너리(N-API)를 쓰므로 Python, Visual Studio, Xcode 같은 컴파일 도구가 필요 없습니다.
- 코드 서명은 하지 않았습니다. macOS에서 처음 열 때 "확인되지 않은 개발자" 경고가 나오면 앱을 **우클릭 → 열기**로 엽니다. Windows SmartScreen 경고가 나오면 "추가 정보 → 실행"을 누릅니다.

## 아두이노 줄 형식

9600 baud, 줄 끝은 `\n` (`\r\n`도 됩니다).

| 보내는 쪽 | 줄 형식 | 의미 |
|---|---|---|
| P1 아두이노 | `P1 <정수>` | 직전 0.1초 동안의 근전도 값(수축할수록 큼). 0.1초마다 계속 보냄 |
| P2 아두이노 | `P2 <정수>` | 위와 같음 |
| START 버튼이 달린 아두이노 (둘 중 한 대) | `START` | 물리 START 버튼이 눌림 |

- 연결된 USB 시리얼 포트를 전부 자동으로 열고 줄 앞부분으로 구분하므로, 어느 아두이노가 어느 포트에 꽂혔는지 신경 쓸 필요가 없습니다. 블루투스 시리얼 포트는 열지 않습니다.
- 케이블이 빠졌다 다시 꽂히면 2초 안에 자동으로 다시 엽니다.
- 최근 2초 안에 `P1`/`P2` 줄이 들어왔으면 관리자 화면에 "연결됨"으로 표시합니다.
- 형식에 맞지 않는 줄(부팅 메시지, 소수, 다른 접두어 등)은 무시합니다. 음수는 0으로 처리합니다.

예시:

```cpp
// P1 아두이노 (START 버튼도 이쪽에 달린 경우)
void loop() {
  static unsigned long last = 0;
  static int peak = 0;
  peak = max(peak, analogRead(A0));
  if (digitalRead(START_PIN) == LOW) { Serial.println("START"); delay(300); }
  if (millis() - last >= 100) { last = millis(); Serial.print("P1 "); Serial.println(peak); peak = 0; }
}
```

## 경기 흐름

```
IDLE(대기) --START--> MEASURING(5초 측정) --양쪽 50개 수신--> 바로 RESULT(P1 승 / P2 승 / DRAW)
RESULT --START--> MEASURING
```

- START(물리 버튼 / 관리자 "새 경기 시작")를 누르면 양쪽 점수를 0으로 비우고 측정을 시작합니다. 측정 중의 START는 무시합니다.
- 측정(5초): P1, P2 줄을 각각 50개씩(0.1초 × 50) 모읍니다.
  - 큰 숫자와 레벨 미터는 **현재 힘**(방금 들어온 값)을 보여줍니다. 값은 0.1초마다 들어오지만 화면은 매 프레임 부드럽게 따라가서 근육에 힘을 주면 올라가고 빼면 내려갑니다.
  - 패널 아래에 "측정 n / 50 · 최고 nnnn"으로 지금까지의 최댓값을 함께 보여줍니다.
- 안전장치: START 후 8초가 지나도 50개가 안 찬 쪽은 받은 것까지의 최댓값으로 확정합니다.
- 결과: 측정이 끝나는 즉시 각자 50개 중 **최댓값**이 최종 점수가 되고, 높은 쪽이 승자, 같으면 DRAW.
- 점수 = `round(원시값 × 보정계수)`를 0~9999로 자른 값. 레벨 미터는 `round(점수 / 9999 × 15)`칸.

## 명예의 전당

- RESULT가 되는 순간 두 선수의 점수를 **각각** 검사합니다. 패자나 DRAW라도 5위보다 높으면(또는 기록이 5개 미만이면) 들어갑니다. 0점은 넣지 않습니다.
- 새 기록 이름은 `ㅇㅇㅇ`이고, 선수(PLAYER 1/2)와 날짜·시간이 함께 저장됩니다.
- 같은 점수면 먼저 세운 기록이 위에 있습니다.
- 점수는 RESULT 확정 즉시 자동 저장됩니다. 관리자는 이름만 고칩니다.

## 관리자 화면

| 동작 | Windows | macOS |
|---|---|---|
| 열기 / 닫기 | `Ctrl + D` | `Control + D` (Cmd 아님) |
| 닫기 | `Esc` 또는 "스코어보드로 돌아가기" | 같음 |

- 명예의 전당 이름 수정 → "이름 저장"(또는 Enter). `ㅇㅇㅇ`인 줄은 강조되고 개수가 표시됩니다. 빈 칸으로 저장하면 `ㅇㅇㅇ`으로 돌아갑니다.
- "새 경기 시작" = START 버튼과 동일.
- "경기 중지 · 기록하지 않음": 측정 중일 때만 누를 수 있고, 아무것도 저장하지 않고 대기 화면으로 돌아갑니다.
- 아두이노 P1/P2 연결 상태와 "포트 다시 연결".
- 보정계수 P1/P2, 시뮬레이션 켜기/끄기.

## 시뮬레이션 모드

`npm run sim`(또는 `--sim`)으로 실행하거나 관리자 화면에서 "시뮬레이션"을 켭니다. 켜면 0.1초마다 P1·P2에 작은 가짜 값이 들어가고(실제 아두이노가 꽂혀 있으면 그 값도 함께 들어옵니다):

| 키 | 동작 |
|---|---|
| `S` | START |
| `A` (누르는 동안) | P1 근육 수축 (값이 서서히 올라가고, 떼면 내려감) |
| `L` (누르는 동안) | P2 근육 수축 |
| `T` (누르는 동안) | 두 쪽에 똑같은 값 (동점 테스트, 그 경기에서 A/L은 누르지 말 것) |

한글 입력 상태에서도 동작합니다. 관리자 화면이 열려 있을 때는 동작하지 않습니다.

## 설정 파일 위치

| OS | 폴더 |
|---|---|
| Windows | `%APPDATA%\raibitScoreboard\` (보통 `C:\Users\<사용자>\AppData\Roaming\raibitScoreboard\`) |
| macOS | `~/Library/Application Support/raibitScoreboard/` |

- `settings.json`: 보정계수, 시작 화면(전체화면 여부). 앱을 끈 상태에서 직접 고쳐도 되고, 관리자 화면에서 고쳐도 됩니다.

  ```json
  {
    "calibration": { "p1": 1.0, "p2": 1.0 },
    "fullscreen": true
  }
  ```

- `hall-of-fame.json`: 명예의 전당 기록.
- 저장은 임시 파일(`*.tmp`)에 쓴 뒤 이름을 바꾸는 방식이라, 저장 도중 꺼져도 원래 파일이 깨지지 않습니다. 파일이 손상돼 읽을 수 없으면 `*.corrupt-<시각>`으로 옮겨 두고 빈 상태로 시작합니다.
- 명예의 전당을 초기화하려면 앱을 끄고 `hall-of-fame.json`을 지웁니다.

## 폴더 구조

```
src/main/main.js      Electron 메인 프로세스 (창, IPC, 타이머)
src/main/game.js      경기 상태 기계 (측정 → 결과)
src/main/hall.js      명예의 전당 규칙
src/main/store.js     JSON 저장 (원자적 쓰기)
src/main/serial.js    시리얼 포트 자동 연결·줄 파싱
src/main/sim.js       시뮬레이션
src/preload.js        렌더러에 노출하는 API
src/renderer/         스코어보드·관리자 화면 (HTML/CSS/JS, 글꼴)
test/game.test.js     단위 테스트
```
