# 배경 이미지 안내 (assets 폴더)

이 폴더에 아래 파일명으로 이미지를 넣으면 **자동으로** 게임 배경에 합성됩니다.
**이미지가 없어도 게임은 정상 작동합니다** — CSS 그라데이션·별자리 효과로 자연스럽게 대체됩니다.
즉, 이미지는 "있으면 더 멋진" 선택 사항입니다.

| 파일명 | 쓰이는 곳 | 권장 사양 | 비고 |
|--------|-----------|-----------|------|
| `bg-cosmos.webp` | 모든 화면 공통 배경(교사·학생) | 1920×1080 이상, 가로 | soft-light로 은은하게 합성됨. 너무 밝거나 복잡한 이미지는 피하세요. |
| `bg-reveal.webp` | 결과 공개 연출 화면(교사 전자칠판) | 1920×1080 이상, 가로 | 위에 어두운 막이 덮이므로 화려해도 OK. 게임의 하이라이트 장면. |

## 파일 형식
- 권장: `.webp` (용량이 작아 로딩이 빠름)
- `.jpg`/`.png`를 쓰려면 위 파일명을 그대로 바꾸고, `teacher.html`·`css/style.css`의 `url(...)` 확장자도 함께 바꿔주세요.

## 이미지 생성 프롬프트 예시 (영문 권장)
세계관: 인류 멸망 후 남은 거대한 예언 장치 / 고대 초월 문명 × 신비로운 미래 기술 / 아카식 레코드 / 우주 관측소.
색감: 짙은 남색 배경, 청록색·금색 포인트.

**bg-cosmos.webp**
> Deep navy cosmic void, faint teal and gold nebula, scattered stars and constellation lines, vast and serene, ancient mystical observatory atmosphere, subtle, dark, cinematic, no text, no people, ultra-wide.

**bg-reveal.webp**
> Enormous circular holographic prophecy device floating in a dark cosmic temple, glowing cyan and gold rings, sacred geometry, akashic records, awe-inspiring and grand, dark navy background, cinematic, no text, no people, ultra-wide.

## 깃허브 연동
저장소에 이 폴더(`assets/`) 그대로 올리고 같은 파일명으로 이미지를 커밋하면, 배포된 링크에서 바로 보입니다.
