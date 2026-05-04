# Changelog

All notable changes to this project will be documented in this file.

## [2026-05-03]
### Added
- **Weather Ingestion System**:
  - Tích hợp Aviation Weather API (METAR/TAF).
  - Hệ thống Normalize dữ liệu thời tiết và đánh giá rủi ro (Risk Evaluator).
  - Cơ chế Cache dữ liệu thời tiết bằng Supabase (`weather_cache` table).
  - Widget `WeatherWatch` (UI component).
- **Event Conflict Detection**: 
  - Logic kiểm tra xung đột giữa các sự kiện IROPS chồng lấn thời gian trên cùng resource.
- **Objective Scoring Refinement**: 
  - Tách biệt `objective-profiles.ts` để quản lý các kịch bản ưu tiên khác nhau.
- **Infrastructure**:
  - Cấu hình `vercel.json` cho deployment.
  - Cập nhật `.env.vercel` cho môi trường cloud.

### Changed
- Cập nhật giao diện Dashboard, Sidebar để hỗ trợ tính năng theo dõi thời tiết.
- Cải tiến logic khôi phục (engine) để xử lý đa sự kiện tốt hơn.

## [2026-05-01]
### Added
- **Vietnam Timezone Support**: 
  - Hiển thị và nhập liệu toàn bộ thời gian theo múi giờ Việt Nam (Asia/Ho_Chi_Minh).
  - Engine vẫn giữ UTC cho tính toán nội bộ.
- **Projected Station Logic**: 
  - Tự động tính toán vị trí tàu bay (station) dựa trên lịch bay thay vì lấy tĩnh từ CSV.

### Changed
- CSV Parser: Tự động nhận diện timezone sân bay để convert local time sang UTC.

## [2026-04-29]
### Added
- Khởi tạo dự án OCC Disruption Recovery Web.
- Core Engine: SINGLE_SWAP, SWAP_CHAIN (Cascade), SPREAD_DELAY, DEEP_DELAY.
- Simulation UI với Gantt Chart.
