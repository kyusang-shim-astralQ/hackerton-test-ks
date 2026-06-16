# be/02 · f1-structure 백엔드 (✅ REAL)

> `be/01-foundation.md` 완료 후, 모노레포 루트 세션에 아래 프롬프트를 붙여넣으세요.

---

## 프롬프트

너는 백엔드 **f1-structure** 기능을 from-scratch로 구현한다(REAL — ASE 라이브러리로 진짜 동작).

### 먼저 읽어라
- `docs/features/f1-structure/api.md` — `POST /analyze-cif` 계약.
- `docs/contracts/data-models.md` — `AtomInfo`/`AnalyzeCifResponse` 정확한 필드.
- `docs/build-prompts/MVP-SCOPE.md`.

### 구현 (`backend/app/features/structure/`)
- **service.py**: 업로드된 CIF(bytes)를 `ase.io.read`로 파싱 → `AtomInfo`를 **data-models.md 키와 1:1**로 생성: `filename, atom_count, atoms[{element,x,y,z}], elements, element_counts, cell, cell_angles, full_coord_text, full_cell_text, use_scaled`(+ 폴백 시 `error`). 파싱 실패/빈 CIF는 계약의 폴백 형태로 방어.
- **router.py**: `POST /analyze-cif`(multipart 필드 `file`) → `AnalyzeCifResponse{status, filename, atom_info, content_hash}`. (다중-CIF는 프런트가 파일별로 이 엔드포인트를 호출하므로, 단일 파일 1회 처리로 충분.)

### 완료 정의 (DoD)
- [ ] 실제 `.cif` 업로드 시 `atom_info`(원자 좌표 포함)를 계약 형태로 반환 → 프런트 3D 뷰어가 렌더 가능.
- [ ] 파싱 실패/빈 CIF 폴백이 계약대로(`atom_count==0`/`error`).
- [ ] 프런트가 여러 파일을 파일별로 호출해도 각 호출이 독립적으로 동작(다중-CIF 지원), `/docs`에서 `/analyze-cif` 확인.
