# 02 · f1-structure — 1단계(구조 입력 및 검증)

> 사용법: `fe/01-foundation.md` 완료 후, 새/같은 Claude Code 세션(프로젝트 루트)에 아래 프롬프트를 붙여넣으세요.

---

## 프롬프트

너는 **f1-structure** 기능(1단계: CIF 업로드 + 구조 분석 + 3D 뷰어)을 `frontend`에 구현하고 실제 백엔드에 연결한다.

### 먼저 읽어라 (단일 소스)
- `docs/features/f1-structure/api.md` — `POST /analyze-cif`의 요청/응답 계약.
- `docs/contracts/data-models.md` — `AtomInfo`, `AnalyzeCifResponse`의 정확한 필드.
- `docs/design-system.md` §4.2(1단계 콘텐츠, 1단계 화면).

### 만들 것 (`app/(wizard)/step-1`)
1. **구조 입력 카드**: 드롭존(드래그&클릭, `.cif/.xyz/POSCAR`, **다중 업로드 허용**) → 업로드된 **각 파일마다** `POST /analyze-cif`(multipart, 필드명 `file`)를 호출하고 응답 `AnalyzeCifResponse`의 `atom_info`를 모은다. 파일이 **1개면 단일 구조**, **2개 이상이면 다중-CIF 흐름**으로 처리한다. 선택된 구조 목록(파일명/화학식)과 활성 구조 인덱스를 wizard-store에 저장(이후 단계가 구조별 `.inp` → 서브잡 N개 → 비교 리포트로 이어진다).
2. **3D 구조 뷰어 카드**: 공유 `MoleculeViewer`(3Dmol)로 **활성 구조**의 `atom_info.atoms`(element/x/y/z)를 sphere+stick으로 렌더, 자동 회전. 오프라인이면 SVG 폴백. 라벨은 `화학식 · 상 · cell` 형태. 다중-CIF면 구조 전환 탭/리스트로 활성 구조를 바꿀 수 있게 한다. **단계 이탈/구조 전환으로 뷰어가 언마운트·재생성될 때 이전 3Dmol 뷰어를 반드시 완전 해제**(`spin(false)` → `clear()` → 캔버스 제거로 WebGL 컨텍스트 해제; design-system §3.11) — 안 그러면 컨텍스트가 누적되어 프리징된다.
3. **구조 메타데이터 카드**: **활성 구조** `AtomInfo`의 화학식/상/공간군/원자수/격자상수 표시(선택 키는 `?.`/기본값 방어).
4. **우측 SummaryPanel "구조" 섹션** 채우기(다중-CIF면 구조 수/목록 요약) + 진행률 1/6. **[다음]** → step-2.

### 연결/상태
- 실제 백엔드(:8000)로 동작(클러스터 불필요, 로컬에서 완전 작동).
- 다중-CIF 업로드 시 파일별 `/analyze-cif` 호출은 병렬/순차로 처리하되, 일부 파일 실패가 전체를 막지 않도록 개별 방어.
- 로딩/에러/빈 상태 처리(파싱 실패 폴백 `atom_info`는 `atom_count==0`/`error` 키로 방어).

### 완료 정의 (DoD)
- [ ] `.cif` 업로드 시 실제 `/analyze-cif` 응답으로 메타데이터+3D 뷰어가 채워진다.
- [ ] `AtomInfo`가 store에 저장되어 우측 패널과 이후 단계에서 재사용된다.
- [ ] 다중-CIF 업로드 시 구조별 `atom_info`가 모두 저장되고, 구조 전환(탭/리스트)으로 뷰어/메타데이터가 활성 구조를 따라간다.
- [ ] 단계를 여러 번 오가거나 구조를 전환해도 3Dmol **WebGL 컨텍스트가 누적되지 않음**(언마운트 시 `spin(false)`+캔버스 제거로 완전 해제; 콘솔에 "Too many active WebGL contexts" 경고 없음).
- [ ] 디자인이 design-system.md(Lab Paper)와 일치, 이모지 없음.
