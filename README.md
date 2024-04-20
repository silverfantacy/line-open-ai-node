# LINE Chatbot

這是一個使用 LINE Bot 和 OpenAI GPT 模型的聊天機器人程式。

## 環境
node.js v20.12.2

## 安裝

1. 複製程式碼到你的專案資料夾中。
2. 在專案資料夾中執行以下指令安裝相依套件：
   ```
   npm install
   ```
3. 複製 `.env.example` 為 `.env`，並在其中設定以下環境變數：
   ```
   CHANNEL_ACCESS_TOKEN = <你的 LINE Bot Channel Access Token>
   CHANNEL_SECRET = <你的 LINE Bot Channel Secret>

   OPENAI_END_POINT = <你的 OpenAI API End Point(非必填)>
   OPENAI_API_KEY = <你的 OpenAI API Key>
   OPENAI_MODEL = <你的 OpenAI 預設模型(非必填)>
   ```
4. 開啟一個終端機視窗，並在專案資料夾中執行以下指令啟動伺服器：
   ```
   npm start
   ```
5. 建議使用 [pm2](https://www.npmjs.com/package/pm2) 來管理 Node.js 伺服器，以確保伺服器能夠持續運行：
   ```
   npm install -g pm2
   pm2 start line-bot-gpt-node
   pm2 restart line-bot-gpt-node
   pm2 stop line-bot-gpt-node
   pm2 log
   ```


## 使用

聊天機器人支援以下指令：

- `!新話題`：開啟新話題。
- `!model查詢`：查詢目前使用的模型。
- `!GPT-3.5-Turbo`：切換至 GPT-3.5-Turbo 模型。
- `!GPT-4-Turbo`：切換至 GPT-4-Turbo 模型。
- `!製作圖片`：製作圖片。

輸入以上指令即可執行相對應的操作。

## 注意事項

- 請確保已經設定正確的 LINE Bot Channel Access Token、Channel Secret 和 OpenAI API Key。
- 請確保專案資料夾中的 `.env` 檔案包含正確的環境變數設定。
- 請確保已安裝所有相依套件。