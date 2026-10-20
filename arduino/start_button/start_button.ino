// START 버튼 전용 스케치. 9600 baud.
//   - 버튼을 누르는 순간(HIGH -> LOW)에 한 번 "START\n" (디바운스 30 ms, 누르고 있어도 반복 안 함)
//   - 1초마다 "ALIVE\n" (앱이 연결 여부를 알 수 있게)
// 배선: 버튼 한쪽은 BUTTON_PIN, 반대쪽은 GND (INPUT_PULLUP 사용)

const int BUTTON_PIN = 2;
const unsigned long DEBOUNCE_MS = 30;
const unsigned long ALIVE_MS = 1000;

int stableState = HIGH;       // 디바운스를 통과한 상태
int lastReading = HIGH;
unsigned long lastChangeAt = 0;
unsigned long lastAliveAt = 0;

void setup() {
  pinMode(BUTTON_PIN, INPUT_PULLUP);
  Serial.begin(9600);
}

void loop() {
  unsigned long now = millis();

  int reading = digitalRead(BUTTON_PIN);
  if (reading != lastReading) {
    lastReading = reading;
    lastChangeAt = now;
  }
  if (now - lastChangeAt >= DEBOUNCE_MS && reading != stableState) {
    stableState = reading;
    if (stableState == LOW) Serial.println("START");
  }

  if (now - lastAliveAt >= ALIVE_MS) {
    lastAliveAt = now;
    Serial.println("ALIVE");
  }
}
