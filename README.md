# 우리집 냉장고

자취방 식재료의 수량, 보관 장소, 소비기한을 관리하는 웹 앱입니다. 소비기한이 빠른 순서로 표시하고, 오늘부터 3일 이내인 식재료를 추천합니다. 기한 경과 항목, 소비 완료 항목, 수정과 삭제도 확인할 수 있습니다.

## Raspberry Pi에서 실행

Node.js 22 이상과 npm이 필요합니다. Raspberry Pi OS에서 기존 Docker MongoDB 컨테이너를 실행하고 호스트에 공개된 포트를 확인합니다.

```bash
node --version
docker ps --format 'table {{.Names}}\t{{.Ports}}'
git clone https://github.com/dlgusgh0810/raspberry-pi-fridge.git
cd raspberry-pi-fridge
npm ci
cp -n .env.example .env
```

`.env`의 `MONGODB_URI`를 컨테이너의 **호스트 포트**에 맞춥니다. 기본값은 `mongodb://127.0.0.1:27017`입니다. 컨테이너에 인증을 설정했다면 해당 사용자, 비밀번호, 인증 DB를 URI에 지정합니다. 기본 앱 DB는 `home_fridge`입니다.

`docker ps`에 `27017/tcp`만 보이면 호스트에서 해당 포트로 접속할 수 없습니다. 기존 데이터 볼륨이나 컨테이너 설정을 보존하면서 호스트 루프백에 포트를 게시하세요. Docker Compose에서는 MongoDB 서비스의 `ports`에 `"127.0.0.1:27017:27017"`을 지정할 수 있습니다.

```bash
npm start
```

Pi에서 브라우저로 `http://127.0.0.1:3000`에 접속합니다. 같은 네트워크의 스마트폰이나 PC에서 접속하려면 `.env`에서 `HOST=0.0.0.0`으로 바꾸고 서버를 재시작한 뒤, 브라우저에서 `http://<Pi의 LAN IP>:3000`을 엽니다. 아이폰에서도 같은 와이파이에 연결한 뒤 Safari에서 이 주소를 열면 됩니다. HTTP로 시연할 때는 신뢰할 수 있는 LAN에서 데모 전용 비밀번호를 사용하세요. HTTPS로 배포할 때는 `COOKIE_SECURE=true`로 설정하세요.

이메일과 8자 이상 비밀번호로 회원가입하면 바로 로그인됩니다. 식재료는 가입한 계정별로 저장됩니다.

회원가입 기능을 추가하기 전에 등록한 식재료를 가져오려면 먼저 사용할 계정에 가입하세요. 서버를 실행한 폴더에서 별도 터미널로 아래 명령을 한 번 실행한 뒤 목록을 새로고침하세요. 이 명령은 아직 계정이 없는 기존 데이터만 지정 계정에 연결합니다.

```bash
npm start -- --assign-legacy 본인이_가입한_이메일
```

시연할 때 식재료를 등록한 뒤 서버를 껐다 켜서 목록에 남아 있는지 확인하세요. 소비기한을 오늘로 설정하면 추천 영역에서 확인할 수 있고, 소비 완료를 누르면 해당 항목이 **소비 완료** 목록으로 이동합니다.

## Raspberry Pi에서 Node.js 서버를 Docker로 실행

기존 MongoDB 컨테이너를 실행한 상태에서 프로젝트 폴더의 `.env`에 기존 `MONGODB_URI`와 `MONGODB_DATABASE`를 유지하세요. `MONGODB_URI`에 포트나 인증 설정이 있다면 그대로 사용합니다. Docker에 넘기는 `.env` 값은 따옴표 없이 `KEY=value` 형식으로 씁니다.

이전에 터미널에서 `npm start`로 웹 서버를 실행했다면 먼저 `Ctrl+C`로 정지하세요. 그런 다음 Pi에서 아래 명령을 실행합니다.

```bash
sudo docker build -t home-fridge:demo .
sudo docker run --rm --init --name home-fridge \
  --network host --env-file .env -e HOST=0.0.0.0 home-fridge:demo
```

Pi의 Linux 호스트 네트워크를 사용하므로 웹 컨테이너는 Pi에 공개된 MongoDB 포트에 기존 `127.0.0.1` 주소로 연결합니다. 웹 포트는 `.env`의 `PORT`를 따르며 기본값은 3000입니다. 같은 와이파이의 아이폰에서는 `http://<Pi의 LAN IP>:3000`을 열면 됩니다.

시연 중 다른 터미널에서 `sudo docker image ls home-fridge`와 `sudo docker ps`를 실행하면 빌드한 이미지와 실행 중인 웹·DB 컨테이너를 보여줄 수 있습니다. 웹 서버는 실행 터미널의 `Ctrl+C`로 종료할 수 있고, MongoDB 컨테이너는 계속 실행됩니다.

## 화면 체험과 테스트

```bash
npm run demo
npm test
TEST_MONGODB_URI=mongodb://127.0.0.1:27017/home_fridge_test npm test
```

`npm run demo`는 샘플 식재료가 들어 있는 체험 모드입니다. 서버를 재시작하면 변경 사항이 초기화됩니다. 제출 시에는 MongoDB에 연결하는 `npm start`를 사용하세요. MongoDB 테스트는 지정한 DB에 임시 컬렉션을 만들어 테스트한 뒤 삭제합니다.
