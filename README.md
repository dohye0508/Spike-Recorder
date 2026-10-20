BYB Spike Recorder
===================

PC와 Mac을 위한 신경 신호 기록 앱입니다. Windows, Linux, OSX에서 실행됩니다.


빌드 방법
------------------------

BYB Spike Recorder를 빌드하려면 아래 단계를 따르세요.

### 의존성 설치

***Windows에서***

- Visual Studio Code를 설치합니다.
- VS Code용 C/C++ 확장을 설치합니다. Extensions 보기(Ctrl+Shift+X)에서 'c++'를 검색해 설치할 수 있습니다.
- MSYS2를 통해 최신 버전의 Mingw32를 받습니다:
  - MSYS2 설치: https://github.com/msys2/msys2-installer/releases/download/2022-01-28/msys2-x86_64-20220128.exe
  - MSYS2 터미널 열기 (시작 메뉴에서 "MSYS2 MSYS" 실행)
  - 패키지 데이터베이스와 기본 패키지 업데이트: ```pacman -Syu```
  - 나머지 기본 패키지 업데이트: ```pacman -Su```
  - Ming32 설치: ```pacman -S mingw-w64-i686-toolchain```
- 이 저장소를 클론합니다.
- 저장소 루트 폴더에서 Visual Studio Code를 엽니다.
- `.vscode/task.json`의 절대 경로가 맞는지 확인합니다.
- Ctrl-Shift-B로 빌드합니다. `SpikeRecorder.exe`가 `win/build/` 폴더에 생성됩니다.

***Linux에서***

터미널을 열고 아래와 같이 git을 설치합니다:
```
$ sudo apt-get install git-core git-gui git-doc
$ git config –global user.name “your-username”
$ git config –global user.email “your@email.com”
```
git 저장소를 보관할 디렉터리를 만듭니다.
만든 디렉터리로 이동해서 입력합니다:
```
$ git init
```
그 다음 저장소를 클론합니다:
```
$ git clone https://github.com/BackyardBrains/Spike-Recorder.git
```
저장소를 클론했으면, 코드를 컴파일할 수 있게 해주는 도구를 설치해야 합니다:
```
$ sudo apt install make
$ sudo apt-get install build-essential g++
```
그 다음 라이브러리를 설치합니다:
```
$ sudo apt-get install -y libhidapi-dev
$ sudo apt-get install libsdl2-dev
```
(이건 Ubuntu 기준이며, 다른 시스템에서는 다를 수 있습니다: https://wiki.libsdl.org/Installation)
```
$ sudo apt-get install libsdl2-image-dev
```

마지막 의존성은 libbass인데, 대부분의 배포판에서 패키지로 제공되지 않습니다. 따라서 수동으로 설치해야 합니다. 아래에서 다운로드하세요
http://www.un4seen.com/download.php?bass24-linux
그리고 임시 디렉터리에 압축을 풉니다.
```
$ mkdir /tmp/bass
$ cd /tmp/bass
$ unzip ~/path/to/bass24-linux.zip
```
그리고 라이브러리를 시스템 라이브러리 디렉터리로 복사합니다
```
$ sudo cp x64/libbass.so /usr/lib/
```
(32비트 시스템에서는 'cp libbass.so /usr/lib')

Spike-Recorder 디렉터리로 이동해서 입력합니다:
```
$ make
```


***OS X에서***

Xcode에서 SpikeRecorder.xcodeproj를 엽니다.


### 실행

빌드가 잘 됐다면, 아래 명령으로 실행할 수 있습니다

```
$ ./SpikeRecorder
```
