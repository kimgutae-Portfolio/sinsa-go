# 신사 자연 재질 텍스처

내장 `image_gen` 도구로 새로 생성한 프로젝트 전용 텍스처입니다. CLI / 외부 모델 API는 사용하지 않았습니다. 원본 생성 PNG(1254px)를 1024px WebP로 변환해 배포 크기를 약 5.2MB에서 0.5MB로 줄였습니다(`cwebp -q 82`, 잎은 `-q 85 -alpha_q 90`으로 알파 채널 보존). 원본 PNG는 Git 기록에서 복구할 수 있습니다.

- `public/textures/cedar-albedo.webp`: 일본 삼나무 / 히노키 계열의 오래된 목재 표면. 색상 맵 및 약한 범프에 사용합니다.
- `public/textures/evergreen-foliage.webp`: 투명 배경 위 상록수 잎 가지. 교차하는 잎 카드와 알파 테스트 그림자에 사용합니다.

두 파일 모두 배포 시 함께 포함되며, 런타임에 이미지 생성 서비스에 연결하지 않습니다. 로드에 실패하면 코드에서 만든 기본 텍스처로 대체합니다. 현재 이미지는 사진 느낌의 색상 텍스처이며 별도 촬영·측정된 PBR 세트가 아닙니다.

## 최종 생성 프롬프트

### cedar-albedo.webp

```text
Use case: photorealistic-natural. Asset type: seamless albedo texture for a realtime 3D Japanese Shinto shrine's timber, square 1024 texture. Primary request: a perfectly flat front orthographic photograph of continuous aged Japanese hinoki / cedar timber. Warm medium brown, restrained gray weathering, long fine wood grain runs vertically, a few subtle narrow cracks and faint knots. Continuous single timber surface, no separate planks, no gaps, no seams or borders. Seamlessly tiling on all four edges. Flat diffuse overcast illumination, no cast shadows, no highlights, no perspective, no objects, no labels. High fidelity natural fibers, delicate rather than exaggerated grain. This is a material texture, not a photograph of a building.
```

### evergreen-foliage.webp

`transparent_background: true`

```text
Use case: photorealistic-natural. Asset type: foliage texture card on true transparent background for realistic realtime Japanese shrine trees. Create one natural dense airy spray of small Japanese evergreen camellia / oak leaves seen straight-on, isolated, centered, approximately circular but with irregular lobed edge, branches emerge from bottom center and divide upward. About 50-80 distinct small narrow oval pointed leaves, muted deep forest greens to fresh olive, natural slightly curled leaves, fine veins, slender dark brown twigs, tiny gaps of transparent background throughout the foliage to let sunlight pass. Foliage fills 90 percent of square canvas but no cropped leaves. Flat soft diffuse daylight, realistic photographic texture, no directional shadows, no pot, no trunk, no landscape, no ground. NOT a solid sphere or stylized cartoon: individual foliage with natural gaps and transparent perimeter. True alpha transparency.
```
