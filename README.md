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

Pi에서 브라우저로 `http://127.0.0.1:3000`에 접속합니다. 같은 네트워크의 스마트폰이나 PC에서 접속하려면 `.env`에서 `HOST=0.0.0.0`으로 바꾸고 서버를 재시작한 뒤, 브라우저에서 `http://<Pi의 LAN IP>:3000`을 엽니다. 이 데모에는 사용자 인증이 없으므로 신뢰할 수 있는 LAN에서만 사용하세요.

시연할 때 식재료를 등록한 뒤 서버를 껐다 켜서 목록에 남아 있는지 확인하세요. 소비기한을 오늘로 설정하면 추천 영역에서 확인할 수 있고, 소비 완료를 누르면 해당 항목이 **소비 완료** 목록으로 이동합니다.

## 화면 체험과 테스트

```bash
npm run demo
npm test
TEST_MONGODB_URI=mongodb://127.0.0.1:27017/home_fridge_test npm test
```

`npm run demo`는 샘플 식재료가 들어 있는 체험 모드입니다. 서버를 재시작하면 변경 사항이 초기화됩니다. 제출 시에는 MongoDB에 연결하는 `npm start`를 사용하세요. MongoDB 테스트는 지정한 DB에 임시 컬렉션을 만들어 테스트한 뒤 삭제합니다.
