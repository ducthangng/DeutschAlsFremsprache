# DeutschFremsprache

Web app luyện phát âm tiếng Đức và tiếng Anh theo kiểu karaoke: app đọc mẫu từng câu, người học đọc theo, Azure chấm phát âm và tô **đỏ đậm** những từ sai. Câu nào đạt thì bản ghi được lưu lại để nghe lại.

- **Backend:** Go (`net/http`), PostgreSQL 17 (pgx v5 + truy vấn sinh bằng **sqlc**), JWT + bcrypt, cấu hình đọc từ `.env`
- **Frontend:** React 18, TypeScript, Tailwind CSS v4, Vite
- **Giọng đọc mẫu:** dùng Web Speech API (`speechSynthesis`) của trình duyệt: không tốn phí, chỉnh được tốc độ (0.5×–1.5×) và giọng; mỗi vai một giọng
- **Chấm điểm:** Azure Pronunciation Assessment (REST). Mỗi lượt chấm được ghi lại thời lượng audio, độ trễ và chi phí ước tính (xem trang **Chi phí**)
- **Nghĩa tiếng Việt:** Azure Translator nếu có key, nếu không thì dùng MyMemory (miễn phí). Bản dịch được cache trong Postgres
- **Tạo topic bằng AI:** OpenAI Chat Completions (mặc định `gpt-4.1-mini`, structured output) viết hội thoại, độc thoại hoặc bài từ vựng kèm nghĩa tiếng Việt
- **Giọng đọc mẫu (tiếng Đức và tiếng Anh):** OpenAI TTS (`gpt-4o-mini-tts`). Mỗi câu chỉ tạo **một lần**, lưu lên **AWS S3** (nếu không có S3 thì lưu trên ổ đĩa) và metadata ghi vào Postgres (`tts_audio`); về sau mọi người đều dùng lại bản đã lưu. Nếu chưa có `OPENAI_API_KEY`, app dùng giọng của trình duyệt. Microsoft Azure chấm phát âm cho cả hai ngôn ngữ (`de-DE` / `en-US`)

## Chạy nhanh

Cần Go 1.22 trở lên, Node 20 trở lên và Docker (để chạy Postgres). Chỉ cần cài [sqlc](https://sqlc.dev) nếu bạn sửa query.

```bash
cp backend/.env.example backend/.env   # điền AZURE_SPEECH_KEY / REGION và JWT_SECRET
cd frontend && npm install && cd ..

make dev-backend    # terminal 1: bật Postgres (docker compose) + API ở :8080
make dev-frontend   # terminal 2: mở http://localhost:5173
```

Bản production là một binary duy nhất phục vụ cả API lẫn frontend: `make run`, rồi mở http://localhost:8080.

## Triển khai: frontend trên Vercel, backend bằng Docker

**Backend (Docker).** Chỉ có một Dockerfile, cho API: [`backend/Dockerfile`](backend/Dockerfile). Image khoảng 17 MB (distroless, chạy bằng user non-root).

```bash
docker build -t deutschfremsprache-api ./backend
docker run -p 8080:8080 --env-file backend/.env deutschfremsprache-api
```

**Railway:** trong Settings của service, đặt **Root Directory = `backend`**. Railway sẽ build bằng `backend/Dockerfile` theo [`backend/railway.json`](backend/railway.json), có health check `/api/health`. Nếu Railway vẫn dùng Railpack, đặt *Config file path* = `/backend/railway.json`. Đừng để Root Directory là `backend/cmd/server`: ở đó Go không thấy `go.mod` nên build sẽ lỗi. Railway tự cấp biến `PORT`; Postgres có thể thêm từ Railway, rồi trỏ `DATABASE_URL` vào đó.

Muốn chạy thử API cùng Postgres trên máy: `make docker`. Cần đặt các biến sau cho backend:

| Biến | Ví dụ | Vì sao |
|---|---|---|
| `DATABASE_URL` | `postgres://…` | Postgres của môi trường production |
| `JWT_SECRET` | chuỗi ngẫu nhiên dài | Ký token đăng nhập |
| `CORS_ORIGIN` | `https://deutsch.example.com,https://*.vercel.app` | Cho phép frontend trên Vercel gọi API. Dấu `*` cho phép cả các bản preview |
| `PUBLIC_URL` | `https://api.example.com` | Để link ảnh và audio là link tuyệt đối, frontend ở domain khác vẫn tải được |
| `S3_BUCKET`, `AWS_*` | | Nên dùng. Nếu không có S3, file nằm ở `/data`, nên mount volume vào đó |

**Frontend (Vercel).** Import repo, đặt **Root Directory = `frontend`**. Vercel tự nhận Vite, và [`frontend/vercel.json`](frontend/vercel.json) chuyển mọi đường dẫn về `index.html` để các link như `/topics/12` hoạt động. Đặt biến môi trường **`VITE_API_URL=https://api.example.com`** (xem `frontend/.env.example`). Khi phát triển ở máy, để trống biến này: Vite tự proxy `/api` sang `localhost:8080`.

> Không commit `backend/.env`: file này đã nằm trong `.gitignore`, cũng như dữ liệu runtime (`backend/data/`), binary và các thư mục build.

**Chế độ demo (mock):** nếu để trống `AZURE_SPEECH_KEY`, app vẫn chạy được nhưng điểm số là giả lập. Trên giao diện có hiển thị banner báo đang ở chế độ này. Lượt chấm mock không tính phí.

> Giọng đọc phụ thuộc vào hệ điều hành và trình duyệt. Chrome và Edge có giọng online chất lượng tốt. Trên macOS có thể cài thêm giọng Đức tại *System Settings → Accessibility → Spoken Content*.

> Trình duyệt chỉ cho phép dùng micro trên `localhost` hoặc HTTPS.

## Cách dùng

1. Đăng ký, rồi bấm **Tạo topic mới**. Chọn ngôn ngữ (Đức/Anh) và loại nội dung (hội thoại/từ vựng).
2. Mỗi dòng là một câu. Phần sau ký tự `|` là nghĩa hoặc ghi chú. Với hội thoại, ghi người nói ở đầu dòng:
   ```
   Anna: Entschuldigung, wo ist Gleis drei? | Xin lỗi, sân ga số 3 ở đâu?
   Bahnmitarbeiter: Gehen Sie geradeaus und dann links.
   ```
3. Ở màn luyện tập, mỗi câu đi theo vòng: nghe mẫu → tự động ghi âm → tự dừng khi bạn ngừng nói → chấm điểm → nếu đạt thì lưu bản ghi và chuyển sang câu tiếp theo.
   - **Vai của bạn:** với hội thoại, bạn có thể chỉ nhập một vai. Câu của các vai khác app sẽ tự đọc rồi đi tiếp.
   - Chỉnh được tốc độ đọc (thanh trượt 0.5×–1.5×), chọn giọng, bật/tắt tự chuyển câu. Các lựa chọn này được nhớ trong trình duyệt.
   - Mỗi câu có nghĩa tiếng Việt: ở dưới câu đang luyện và trong cột kịch bản. Nếu đã ghi nghĩa sau `|` thì app dùng nghĩa đó, nếu chưa thì dùng máy dịch.
   - **Bôi đen hoặc nhấp đúp** vào từ (trong câu đang luyện hoặc trong kịch bản) để mở popup: 🔊 nghe lại, 🐢 nghe chậm, 📖 xem nghĩa, ＋ lưu vào Vocabulary Pocket. Câu chứa từ đó được lưu làm ví dụ.
   - Dưới kết quả có dòng chi phí, ví dụ: `☁️ 2.1 giây audio · ≈ $0.00116 · 792 ms`. Mỗi bản ghi trong mục *Bản ghi đạt của câu này* cũng hiện chi phí chấm điểm của nó.
4. **🎒 Vocabulary Pocket (cũ, xem mục 14):** thêm từ (có nút 🪄 dịch tự động), tìm kiếm, sửa, xoá. Bấm **Ôn tập** để học bằng flash card: Space để lật thẻ, phím `1` là chưa nhớ, phím `2` là đã nhớ. Có chế độ đảo chiều Nghĩa → Từ. Lịch ôn theo hộp Leitner: từ đã nhớ được giãn ra 1, 2, 4, 8, 16, 32 ngày; từ quên thì quay về hộp 1 và được hỏi lại sau 10 phút.
5. **Tạo topic bằng AI** (cột trái của trang *Tạo topic mới*): nhập chủ đề/tình huống, các từ vựng mới, loại nội dung (hội thoại 2 người / độc thoại / từ vựng), trình độ (A1–C2) và số câu, rồi bấm **Generate**. Nội dung sẽ được điền vào form để bạn xem lại và sửa. Chọn những từ muốn thêm vào Pocket, rồi bấm **Tạo topic**. Mỗi lần tạo đều hiện số token và chi phí; mọi lần tạo (kể cả tạo lại) đều được tính vào chi phí của topic.
6. **Trạng thái topic:** 🔒 Riêng tư / 🌐 Công khai, số lần **hoàn thành** (một lần hoàn thành là khi người học đọc đạt hết các câu của mình trong một buổi luyện) và **tổng chi phí**. Bấm nút *Công khai*/*Ẩn* trên thẻ topic để đổi trạng thái.
7. **🌐 Topic công khai:** danh sách topic mọi người chia sẻ, có tên người chia sẻ. Người khác luyện với bản ghi và điểm của riêng mình, nhưng không sửa được nội dung. Màn luyện tập có bảng **Chi phí của topic**, chia theo **từng người** (chấm điểm / kịch bản AI / giọng đọc AI).
8. **Giọng đọc tạo bằng OpenAI (tiếng Đức và tiếng Anh):** lần đầu một câu được đọc, màn hình hiện *Generating…* (đang tạo, có tính phí). Những lần sau, với bất kỳ ai, màn hình hiện *Loading…* (tải bản đã lưu, miễn phí). Tốc độ đọc được chỉnh lúc phát (giữ nguyên cao độ), nên không phải tạo lại audio.
9. **Hai chế độ cho mỗi topic** (nút chuyển ở màn luyện tập):
   - 🗣 **Shadowing**: nghe rồi đọc theo, Azure chấm phát âm.
   - ✍️ **Nghe – Viết**: nghe câu rồi gõ lại. Máy chấm từng từ ngay lập tức và miễn phí (không gọi AI). Từ đúng hiện màu xanh; sai viết hoa/thường, viết umlaut thành ae/oe/ue/ss hoặc lỗi chính tả nhỏ hiện màu vàng và được tính một phần điểm; từ sai, thiếu, thừa hiện màu đỏ. Từ 85 điểm trở lên là đạt. Phím tắt: Enter để kiểm tra / sang câu tiếp, Esc để nghe lại.
10. **Playlist:** gom topic thành lộ trình, có tên, trình độ (A1–C2) và mô tả. Thêm topic qua menu ⋯ trên thẻ topic hoặc trong màn luyện tập. Playlist công khai có thể được người khác **theo dõi**; mỗi người thấy tiến độ của chính mình (số topic xong, %). Topic riêng tư trong playlist công khai sẽ bị ẩn với người khác.
11. **Hình ảnh:** mỗi topic có ảnh bìa, và mỗi câu có thể có ảnh riêng (thêm trong trang sửa topic: bấm, kéo thả hoặc dán ảnh). Ảnh tối đa 5 MB, lưu cùng chỗ với audio (S3).
12. **Giao diện:** tông tối dịu mắt theo kiểu Netflix. Trang chủ có banner topic đang học và các hàng *Tiếp tục luyện*, *Playlist*, *Topic của tôi*, *Mới từ cộng đồng*. Mục *Khám phá* gồm playlist và topic công khai. Mọi hộp xác nhận đều là popup của app thay vì hộp thoại của trình duyệt.
13. **🎲 Mô phỏng:** AI tạo một tình huống mới dựa trên lịch sử học của bạn (các topic đã luyện, từ trong Pocket, trình độ, cộng thêm chủ đề nếu bạn gợi ý) rồi đóng vai người đối thoại trong tối đa 10 lượt. Mỗi lượt:
    - Bạn nói (micro tự dừng khi im lặng; Space để bắt đầu/dừng) hoặc gõ.
    - Azure ghi lại thành chữ, sau đó chấm phát âm dựa trên chính câu vừa ghi; từ phát âm sai được tô đỏ.
    - OpenAI chấm **logic** (câu có hợp ngữ cảnh không), đưa nhận xét, gợi ý câu nói tự nhiên hơn và một lưu ý ngữ pháp, rồi trả lời theo vai.
    - Người đối thoại đọc câu của họ (dùng OpenAI TTS nếu có, nếu không dùng giọng của trình duyệt).

    Khi xong 10 lượt, hội thoại tự kết thúc, hoặc bạn bấm kết thúc sớm. Bản tổng kết gồm điểm tổng, mục tiêu đạt hay chưa, trình độ thể hiện (CEFR), điểm mạnh, điểm cần cải thiện, và các cụm từ nên học (thêm được vào Pocket chỉ với một nút). Mọi thứ đều được lưu: kịch bản, từng lượt (chữ, bản ghi âm trên S3, điểm, nhận xét), chi phí từng lượt và chi phí tổng chia theo Azure / OpenAI / giọng đọc, số token và số giây audio.
14. **🎒 Flash card (Vocabulary Pocket):** lịch ôn kiểu SM-2 riêng cho từng từ của từng người, với 4 mức Quên / Khó / Nhớ / Dễ. Mỗi nút hiện thời điểm bạn sẽ gặp lại thẻ (VD: 10 phút, 1 ngày, 8 ngày); phím Space để lật thẻ, phím 1–4 để chấm. Mỗi từ có ảnh: tải lên, kế thừa từ ảnh của câu khi lưu từ trong lúc luyện topic, hoặc bấm ✨ để AI vẽ (khoảng $0.011 mỗi ảnh). Tab *Tổng quan* có vòng mục tiêu hôm nay, số thẻ đến hạn, chuỗi ngày 🔥 (và kỷ lục), tỉ lệ nhớ 30 ngày, số từ đã thuộc, tổng thời gian ôn, thanh mức độ ghi nhớ (mới → đã thuộc), biểu đồ 30 ngày gần nhất và dự báo 7 ngày tới.
15. **Chi phí:** tổng chi phí tháng này và từ trước đến nay (số lượt chấm, phút audio, chi phí chấm, số ký tự dịch, chi phí dịch), kèm bảng 50 lượt chấm gần nhất.
   - Phím tắt: `Space` để bắt đầu/dừng, `←` `→` để chuyển câu, `Esc` để dừng.

Khi sửa topic, những câu giữ nguyên chữ vẫn còn bản ghi cũ. Câu bị xoá hoặc sửa chữ sẽ mất bản ghi.

## Cấu hình (`backend/.env`)

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `DATABASE_URL` | `postgres://dfs:dfs@localhost:5432/deutschfremsprache?sslmode=disable` | Chuỗi kết nối Postgres (khớp với `docker-compose.yml`) |
| `AZURE_SPEECH_KEY`, `AZURE_SPEECH_REGION` | trống | Key và region của Azure Speech. Để trống thì app chạy ở chế độ mock |
| `JWT_SECRET` | dev secret | **Bắt buộc đặt khi chạy production** |
| `AZURE_TRANSLATOR_KEY`, `AZURE_TRANSLATOR_REGION` | trống, region mặc định theo Speech | Azure Translator để dịch nghĩa. Để trống thì dùng MyMemory |
| `MYMEMORY_EMAIL` | trống | Tăng hạn mức miễn phí của MyMemory |
| `AZURE_ASSESS_USD_PER_HOUR` | `2.0` | Đơn giá ước tính cho mỗi giờ audio chấm điểm (STT khoảng $1 + add-on pronunciation assessment khoảng $1) |
| `AZURE_TRANSLATOR_USD_PER_MILLION_CHARS` | `10` | Đơn giá ước tính của Azure Translator |
| `OPENAI_API_KEY` | trống | Bật tính năng tạo bằng AI và giọng đọc OpenAI cho cả tiếng Đức lẫn tiếng Anh |
| `OPENAI_CHAT_MODEL`, `OPENAI_CHAT_USD_PER_M_INPUT/OUTPUT` | `gpt-4.1-mini`, `0.40`, `1.60` | Model viết kịch bản và đơn giá token |
| `OPENAI_TTS_MODEL`, `OPENAI_TTS_USD_PER_MINUTE` | `gpt-4o-mini-tts`, `0.015` | Model giọng đọc và đơn giá ước tính |
| `S3_BUCKET`, `AWS_REGION`, `S3_PREFIX` | trống, `eu-central-1`, `deutschfremsprache` | Nơi lưu **mọi file**: bản ghi âm (`recordings/`), giọng đọc AI (`tts/`), ảnh (`images/`). Để trống `S3_BUCKET` thì lưu tại `DATA_DIR/media` |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `S3_ENDPOINT` | trống | Thông tin đăng nhập S3 (trống thì dùng credential chain mặc định); endpoint dùng cho R2/MinIO |
| `OPENAI_IMAGE_MODEL`, `OPENAI_IMAGE_USD` | `gpt-image-1`, `0.011` | Model vẽ ảnh flash card và đơn giá mỗi ảnh |
| `AZURE_STT_USD_PER_HOUR` | `1.0` | Đơn giá ghi âm thành chữ (dùng trong mô phỏng) |
| `PASS_THRESHOLD` | `70` | PronScore tối thiểu để một câu được tính là đạt |
| `WORD_THRESHOLD` | `60` | Từ có AccuracyScore thấp hơn mức này bị đánh dấu sai |
| `DATA_DIR` | `./data` | Nơi chứa file ghi âm (WAV). Database chỉ lưu metadata |
| `STATIC_DIR` | `../frontend/dist` | Thư mục frontend đã build |
| `PORT` | `8080` | Cổng HTTP |

## Kiến trúc

```
backend/
  cmd/server/            entrypoint
  internal/api/          REST handlers, phục vụ SPA
  internal/speech/       client Azure Pronunciation Assessment, căn từ (align), mock
  internal/translate/    Azure Translator / MyMemory (dịch nghĩa tiếng Việt)
  internal/openai/       OpenAI: tạo kịch bản (JSON schema) + TTS (PCM → WAV)
  internal/storage/      lưu audio: S3 (presigned URL) hoặc ổ đĩa (URL ký HMAC)
  internal/db/
    migrations/          schema Postgres (*.sql), tự chạy khi server khởi động
    queries/             truy vấn SQL cho sqlc
    gen/                 code do sqlc sinh ra (không sửa tay)
    migrate.go           runner migration (advisory lock, bảng schema_migrations)
  internal/store/        lớp persistence: transaction + chuyển đổi kiểu trên nền sqlc
  internal/topic/        parser cho nội dung topic ("Speaker: text | note")
  internal/auth/         bcrypt, JWT, middleware
frontend/src/
  pages/Practice.tsx     vòng karaoke (state machine: playing → recording → assessing → result)
  lib/audio.ts           ghi âm, phát hiện im lặng, resample về WAV 16 kHz mono
  lib/api.ts             API client có kiểu
```

**Luồng âm thanh:** trình duyệt ghi âm bằng `MediaRecorder`, giải mã rồi resample về PCM 16 kHz mono 16-bit WAV bằng `OfflineAudioContext`. Đây là định dạng mà REST API Pronunciation Assessment của Azure nhận. Backend gửi file WAV kèm `ReferenceText` (`Granularity=Phoneme`, `EnableMiscue=true`), rồi căn các từ Azure trả về với văn bản gốc (Azure trả từ viết thường, bỏ dấu câu, đôi khi tách một từ thành nhiều từ). Nhờ vậy giao diện hiển thị đúng câu người dùng đã nhập.

Lượt nào không phát hiện được giọng nói thì không gửi lên Azure, nên không tốn phí.

### REST API

Mọi endpoint, trừ auth và health, đều cần header `Authorization: Bearer <token>`.

| Method | Path | |
|---|---|---|
| POST | `/api/auth/register`, `/api/auth/login` | `{email, password, name?}` → `{token, user}` |
| GET | `/api/me` | người dùng hiện tại |
| GET/POST | `/api/topics` | danh sách / tạo `{title, description, language, kind, content}` |
| GET/PUT/DELETE | `/api/topics/{id}` | chi tiết (gồm items, voice, recordings) / sửa / xoá |
| POST | `/api/items/{id}/assess` | multipart `audio` (WAV) → điểm, tokens, `usage` (audio ms, độ trễ, chi phí), bản ghi nếu đạt |
| GET | `/api/topics/public` | topic công khai (kèm tên người chia sẻ, số lần hoàn thành, tổng chi phí) |
| PATCH | `/api/topics/{id}/visibility` | `{visibility: "private"\|"public"}`, chỉ chủ topic |
| POST | `/api/topics/{id}/complete` | ghi nhận một lần hoàn thành |
| GET | `/api/topics/{id}/costs` | chi phí của topic theo từng người |
| POST | `/api/generate/script` | `{language, speechType, scenario, vocabulary[], level, lines}` → nội dung + token + chi phí + `generationId` |
| POST | `/api/items/{id}/speech` | giọng đọc mẫu: trả về URL phát được (presigned S3), `cached`, `costUsd` |
| POST | `/api/items/{id}/dictation` | `{answer}` → điểm Nghe – Viết, kết quả từng từ |
| POST | `/api/images` | multipart `image` → `{key, url}` (URL có chữ ký, cache được một ngày) |
| GET/POST | `/api/playlists`, `/api/playlists/public` | playlist của tôi + đang theo dõi / công khai / tạo |
| GET/PUT/DELETE | `/api/playlists/{id}` | chi tiết (kèm topic và tiến độ của người xem) / sửa / xoá |
| POST/DELETE | `/api/playlists/{id}/topics[/{topicId}]`, `PUT …/order` | thêm / bỏ / sắp xếp topic |
| POST/DELETE | `/api/playlists/{id}/follow` | theo dõi / bỏ theo dõi |
| GET | `/api/vocab/stats?tz=<phút lệch so với UTC>` | thống kê flash card |
| POST | `/api/vocab/{id}/review` | `{grade: 1-4, durationMs}` → lịch ôn mới |
| POST | `/api/vocab/{id}/image` | AI vẽ ảnh cho từ |
| GET/POST | `/api/simulations` | lịch sử / tạo mô phỏng `{language, level, hint}` |
| GET | `/api/simulations/{id}` | toàn bộ lượt + chi phí |
| POST | `/api/simulations/{id}/turns` | multipart `audio` (WAV) hoặc `text` → chấm và AI trả lời |
| POST | `/api/simulations/{id}/finish`, `…/turns/{turnId}/speech` | kết thúc + tổng kết / URL audio của lượt |
| POST | `/api/translate` | `{language, texts[]}` → nghĩa tiếng Việt (có cache) |
| GET | `/api/usage` | chi phí tháng này / từ trước đến nay + 50 lượt chấm gần nhất |
| GET/POST | `/api/vocab` | danh sách / thêm từ `{language, term, meaning, example, topicId?}` |
| PUT/DELETE | `/api/vocab/{id}` | sửa / xoá từ |
| POST | `/api/vocab/{id}/review` | `{remembered}` → cập nhật hộp Leitner và hạn ôn |
| GET | `/api/recordings/{id}/audio[?download=1]` | nghe bản ghi; `download=1` trả về file đính kèm có tên dễ đọc |
| GET | `/api/topics/{id}/recordings.zip` | tải mọi bản ghi của topic thành một file ZIP |
| DELETE | `/api/recordings/{id}` | xoá bản ghi |

## Test

```bash
make test   # parser, căn từ, parse response Azure, luồng API end-to-end trên Postgres thật
```

Test API chạy trong một schema tạm (`test_<timestamp>`) và tự xoá schema đó sau khi chạy xong. Nếu không đặt `TEST_DATABASE_URL`, test API sẽ được bỏ qua.

## Database và sqlc

- Schema nằm trong [backend/internal/db/migrations/](backend/internal/db/migrations/). Để thay đổi schema, thêm file mới, ví dụ `0002_xxx.sql`; không sửa file đã chạy. Server tự áp dụng các migration còn thiếu khi khởi động.
- Truy vấn nằm trong [backend/internal/db/queries/](backend/internal/db/queries/). Sau khi sửa migration hoặc query, chạy `make sqlc` để sinh lại `internal/db/gen/`.
- File (bản ghi âm, giọng đọc AI, ảnh) lưu trên S3, hoặc trên `DATA_DIR/media` nếu chưa cấu hình S3; Postgres chỉ lưu key. Bản ghi âm cũ còn nằm trên đĩa sẽ được tự động chuyển lên S3 khi server khởi động.
- Quyền IAM cần có trên bucket: `s3:PutObject`, `s3:GetObject`, và nên có thêm `s3:DeleteObject` để xoá file khi bạn xoá bản ghi hoặc topic. Nếu thiếu quyền xoá thì app vẫn chạy bình thường, chỉ còn sót file trên S3.

## Tải bản ghi

- Mỗi bản ghi đạt có nút **⬇ Tải** (WAV 16 kHz mono). Tên file có dạng `am-bahnhof-01-anna-wo-ist-gleis-drei-87-20261016-141500.wav`.
- Sau mỗi lần đọc, kể cả khi chưa đạt, có nút **⬇ Tải bản ghi này** để tải đúng lần đọc vừa rồi.
- Nút **⬇ Tải tất cả bản ghi (.zip)** ở đầu màn luyện tập tải toàn bộ bản ghi của topic.
