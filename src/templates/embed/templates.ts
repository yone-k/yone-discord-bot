export const templates = {
  list: `# {list_title}

{category_sections}

---
[スプレッドシートを開く]({spreadsheet_url})
合計: {total_count}項目 | 最終更新: {last_update}`,

  default: `# {title}

{content}

---
{timestamp}`,

  error: `# ❌ エラーが発生しました

{error_message}

## 📝 詳細
{error_details}

---
発生時刻: {timestamp}`
};