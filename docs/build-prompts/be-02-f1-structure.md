# be-02 · f1-structure 백엔드 (✅ REAL)

> `be-01-foundation.md` 완료 후, 모노레포 루트 세션에 아래 프롬프트를 붙여넣으세요.

---

## 프롬프트

너는 백엔드 **f1-structure** 기능을 from-scratch로 구현한다(REAL — ASE 라이브러리로 진짜 동작).

### 먼저 읽어라
- `docs/features/f1-structure/api.md` — `POST /analyze-cif`, `POST /update-kpoint-cache` 계약.
- `docs/contracts/data-models.md` — `AtomInfo`/`AnalyzeCifResponse`/`KpointCacheUpdate` 정확한 필드.
- `docs/build-prompts/MVP-SCOPE.md`.

### 구현 (`backend/app/features/structure/`)
- **service.py**: 업로드된 CIF(bytes)를 `ase.io.read`로 파싱 → `AtomInfo`를 **data-models.md 키와 1:1**로 생성: `filename, atom_count, atoms[{element,x,y,z}], elements, element_counts, cell, cell_angles, full_coord_text, full_cell_text, use_scaled, kpoint_recommended, initial_guess_kpoint`(+ 폴백 시 `error`). 파싱 실패/빈 CIF는 계약의 폴백 형태로 방어.
  - k-point: **휴리스틱** — 최소 격자 길이 < 10Å이면 `kpoint_recommended=true`, `initial_guess_kpoint`는 격자 기반 간단 메쉬(예: 큰 축일수록 작게).
  - 캐시: 간단한 dict 또는 JSON 파일(`content_hash → kpoint`). `save_by_hash(content_hash, kpoint)` public 메서드.
- **router.py**: `POST /analyze-cif`(multipart 필드 `file`) → `AnalyzeCifResponse{status, filename, atom_info, content_hash, cached_kpoint}`. `POST /update-kpoint-cache`(`{content_hash, kpoint}`) → 캐시 저장.

### 완료 정의 (DoD)
- [ ] 실제 `.cif` 업로드 시 `atom_info`(원자 좌표 포함)를 계약 형태로 반환 → 프런트 3D 뷰어가 렌더 가능.
- [ ] 파싱 실패/빈 CIF 폴백이 계약대로(`atom_count==0`/`error`).
- [ ] 캐시 저장/조회 동작, `/docs`에서 두 엔드포인트 확인.
