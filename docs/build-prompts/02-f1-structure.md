# 02 · f1-structure — 1단계(구조 입력 및 검증)

> 사용법: `01-foundation.md` 완료 후, 새/같은 Claude Code 세션(프로젝트 루트)에 아래 프롬프트를 붙여넣으세요.

---

## 프롬프트

너는 **f1-structure** 기능(1단계: CIF 업로드 + 구조 분석 + 3D 뷰어)을 `frontend-next`에 구현하고 실제 백엔드에 연결한다.

### 먼저 읽어라 (단일 소스)
- `docs/features/f1-structure/api.md` — `POST /analyze-cif`, `POST /update-kpoint-cache`의 요청/응답 계약.
- `docs/contracts/data-models.md` — `AtomInfo`, `AnalyzeCifResponse`, `KpointCacheUpdate`의 정확한 필드.
- `docs/design-system.md` §4.2(1단계 콘텐츠) + `docs/mockups/a-paper-hifi.html`(1단계 화면).

### 만들 것 (`app/(wizard)/step-1`)
1. **구조 입력 카드**: 드롭존(드래그&클릭, `.cif/.xyz/POSCAR`, 다중 허용) → `POST /analyze-cif`(multipart, 필드명 `file`). 응답 `AnalyzeCifResponse`의 `atom_info`를 wizard-store에 저장.
2. **3D 구조 뷰어 카드**: 공유 `MoleculeViewer`(3Dmol)로 `atom_info.atoms`(element/x/y/z)를 sphere+stick으로 렌더, 자동 회전. 오프라인이면 SVG 폴백. 라벨은 `화학식 · 상 · cell` 형태.
3. **구조 메타데이터 카드**: `AtomInfo`의 화학식/상/공간군/원자수/격자상수 표시(선택 키는 `?.`/기본값 방어).
4. **K-point 자동 적용**(스캔 UI 없음): `atom_info.kpoint_recommended`면 `initial_guess_kpoint`를, 응답에 `cached_kpoint`가 있으면 그 값을 store의 `verified_optimal_kpoint`로 자동 반영. (원본의 스캔 플로우는 제거됨 — design-system §8 참조.)
5. **우측 SummaryPanel "구조" 섹션** 채우기 + 진행률 1/6. **[다음]** → step-2.

### 연결/상태
- 실제 백엔드(:8000)로 동작(클러스터 불필요, 로컬에서 완전 작동).
- `/update-kpoint-cache`는 계약대로 호출부만 마련(현재는 트리거 없음 — 호출하지 않아도 됨).
- 로딩/에러/빈 상태 처리(파싱 실패 폴백 `atom_info`는 `atom_count==0`/`error` 키로 방어).

### 완료 정의 (DoD)
- [ ] `.cif` 업로드 시 실제 `/analyze-cif` 응답으로 메타데이터+3D 뷰어가 채워진다.
- [ ] `AtomInfo`가 store에 저장되어 우측 패널과 이후 단계에서 재사용된다.
- [ ] kpoint 권장/캐시 값이 자동 반영된다(스캔 UI 없음).
- [ ] 디자인이 design-system.md(Lab Paper)와 일치, 이모지 없음.
