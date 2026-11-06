# 검색 노출 설정

사이트의 기본 언어는 일본어이며 대표 주소는 `https://komorebi-jinja.com`입니다. 온라인 참배·오미쿠지·에마를 제공하는 브라우저 체험으로 소개합니다. 실재하는 신사의 주소나 검증되지 않은 운영 기관·평점은 기재하지 않습니다.

## 공개 페이지

- `/`: 게임과 초기 로딩 안내. 게임이 준비되기 전에도 소개 페이지 링크를 읽을 수 있습니다. Vue가 시작된 뒤에는 실제 게임 화면의 H1과 「神社について」 링크를 사용합니다.
- `/about`: 일본어 소개와 이용 안내. JavaScript나 WebGL을 실행하지 않아도 제목·본문·경내 이미지·링크를 읽을 수 있는 HTML입니다.
- 존재하지 않는 주소·누락된 정적 파일은 404입니다. 게임 홈을 대신 200으로 반환하지 않습니다.

두 공개 페이지는 각자의 제목·설명·canonical을 사용합니다. `/about/`, `/about/index.html`, `/index.html`은 대표 경로로 308 이동하며 쿼리는 유지합니다. 방 선택·유입 매개변수는 별도 검색 페이지로 만들지 않습니다.

## 편집 위치

- `src/shared/site.ts`: 대표 주소, 검색 제목·설명, OG/X 태그, 사이트명·페이지 구조화 데이터, robots.txt와 sitemap.xml.
- `src/shared/about.ts`, `public/about.css`: 소개 페이지 본문·디자인과 게임 초기 안내.
- `scripts/branding/metadata-plugin.ts`: 개발·미리보기 응답과 빌드 산출물 생성.
- `server/app.ts`: 운영 환경의 공개 경로·별칭·상태 코드와 관리자 검색 제외 헤더.

빌드 시 `SITE_URL=https://komorebi-jinja.com npm run build`로 대표 주소를 명시할 수 있습니다. 주소를 바꿀 때는 경로가 없는 HTTPS origin을 사용합니다.

## 검색 로봇과 구조화 데이터

`robots.txt`는 공개 사이트와 이미지·스크립트의 수집을 허용하고, API 수집은 제한합니다. 관리자 경로를 robots.txt로 차단하지 않고 응답의 `X-Robots-Tag: noindex`를 읽을 수 있게 유지합니다. 관리자 인증과 검색 제외는 별개의 기능입니다.

홈에는 `WebSite`와 `WebPage`, 소개 페이지에는 해당 페이지의 `WebPage` 정보를 초기 HTML에 제공합니다. 검색 엔진 전용의 숨은 키워드나 사용자 에이전트별 본문을 사용하지 않습니다. 사이트맵에는 공개 홈·소개 페이지만 나열하며 수정 시각을 임의로 만들어 넣지 않습니다.

이전 Fly 주소는 브라우저별 익명 기록·에마 소유권 접근을 보존하기 위해 강제 이동시키지 않습니다. 검색용 canonical은 새 도메인을 가리킵니다.

## Google Search Console

등록된 도메인 속성은 `komorebi-jinja.com`입니다. 배포 후 다음 공개 주소와 사이트맵을 확인합니다.

1. `https://komorebi-jinja.com/`
2. `https://komorebi-jinja.com/about`
3. `https://komorebi-jinja.com/sitemap.xml`

Search Console의 **Sitemaps**에서 사이트맵을 제출하고 처리 상태를 확인합니다. URL 검사에서는 공개 페이지의 색인 상태와 Google이 선택한 대표 URL을 확인할 수 있습니다. 사이트명 구조화 데이터는 Rich Results Test의 지원 대상과 다를 수 있으므로 초기 HTML의 JSON-LD도 함께 확인합니다.

설정은 검색 엔진이 내용을 이해하고 수집하도록 돕습니다. 실제 색인·검색 결과 반영 시점과 순위는 Google이 결정합니다.

공식 참고: [Google JavaScript SEO](https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics), [검색 결과의 사이트명](https://developers.google.com/search/docs/appearance/site-names), [SEO 기본 가이드](https://developers.google.com/search/docs/fundamentals/seo-starter-guide).
