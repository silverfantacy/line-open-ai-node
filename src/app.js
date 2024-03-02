require('dotenv').config();
const express = require('express');
const line = require('@line/bot-sdk');
const request = require('request');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const CHANNEL_ACCESS_TOKEN = process.env["CHANNEL_ACCESS_TOKEN"];
const CHANNEL_SECRET = process.env["CHANNEL_SECRET"];
const OPENAI_END_POINT = process.env["OPENAI_END_POINT"] || 'https://api.openai.com';
const OPENAI_API_KEY = process.env["OPENAI_API_KEY"];
const OPENAI_MODEL = process.env["OPENAI_MODEL"] || 'gpt-3.5-turbo';

// 建立 LINE Bot 物件
const config = {
  channelAccessToken: CHANNEL_ACCESS_TOKEN,
  channelSecret: CHANNEL_SECRET
};
const bot = new line.Client(config);

const quickReply = {
  items: [
    {
      type: "action",
      imageUrl: "https://th.bing.com/th?q=%e6%98%9f%e8%a1%97&w=42&h=42&c=7&rs=1&p=0&o=5&dpr=2&pid=1.7&mkt=zh-TW&cc=TW&setlang=zh-Hant&adlt=moderate&t=1",
      action: {
        type: "message",
        label: "新話題",
        text: "!新話題"
      }
    },
    {
      type: "action",
      imageUrl: "https://th.bing.com/th?q=%e6%98%9f%e8%a1%97&w=42&h=42&c=7&rs=1&p=0&o=5&dpr=2&pid=1.7&mkt=zh-TW&cc=TW&setlang=zh-Hant&adlt=moderate&t=1",
      action: {
        type: "message",
        label: "Modal查詢",
        text: "!Modal查詢"
      }
    },
    {
      type: "action",
      imageUrl: "https://th.bing.com/th?q=%e6%98%9f%e8%a1%97&w=42&h=42&c=7&rs=1&p=0&o=5&dpr=2&pid=1.7&mkt=zh-TW&cc=TW&setlang=zh-Hant&adlt=moderate&t=1",
      action: {
        type: "message",
        label: "GPT-3.5-Turbo",
        text: "!GPT-3.5-Turbo"
      }
    },
    {
      type: "action",
      imageUrl: "https://th.bing.com/th?q=%e6%98%9f%e8%a1%97&w=42&h=42&c=7&rs=1&p=0&o=5&dpr=2&pid=1.7&mkt=zh-TW&cc=TW&setlang=zh-Hant&adlt=moderate&t=1",
      action: {
        type: "message",
        label: "GPT-4-0125-Preview",
        text: "!GPT-4-0125-Preview"
      }
    }
  ]
}

// 建立 Express 實例
const app = express();

// 設定 webhook 處理函式
app.post('/webhook', line.middleware(config), (req, res) => {
  Promise
    .all(req.body.events.map(handleEvent))
    .then((result) => res.json(result))
    .catch((err) => {
      console.error(err);
      res.status(500).end();
    });
});

// 處理每個事件
// { role: "system", content: '直接回答內容。回答必須簡潔。回答應情景式、對話式。回答允許休閒。回答避免反對、警告、總結。回答不應抽象、詳細解釋、追溯原因。' }
async function handleEvent(event) {
  const { type, message } = event;
  if (type !== 'message' || message.type !== 'text') {
    return null;
  }

  const user_id = 'line_' + event.source.userId;
  const hash = crypto.createHash('sha256').update(user_id).digest('hex');
  const requestString = `${message.text}`;

  switch (requestString) {
    case '!新話題': {
      const directory = path.join(__dirname, 'users', hash);
      // 修改資料夾名稱 最前面加上 [X]
      const newDirectoryName = `[X]${hash}`;
      fs.renameSync(directory, path.join(__dirname, 'users', newDirectoryName));
      return bot.replyMessage(event.replyToken, { type: 'text', text: '已經開啟新話題', quickReply })

      // fs.rmdir(directory, { recursive: true }, (err) => { // 使用 fs.rmdir 刪除資料夾
      //   if (err) {
      //     console.error(`Error deleting directory ${directory}: ${err}`)
      //     return
      //   }
      //   return bot.replyMessage(event.replyToken, { type: 'text', text: '已經開啟新話題' })
      // })
      break;
    }
    case '!Modal查詢': {
      const { currentModel } = await getCustomConfig(hash);
      return bot.replyMessage(event.replyToken, { type: 'text', text: `目前使用: ${currentModel}` })
      break;
    }
    case '!GPT-3.5-Turbo': {
      saveCustomfile(hash, 'gpt-3.5-turbo');
      return bot.replyMessage(event.replyToken, { type: 'text', text: `已切換至: gpt-3.5-turbo`, quickReply })
      break;
    }
    case '!GPT-4-0125-Preview': {
      saveCustomfile(hash, 'gpt-4-0125-preview');
      return bot.replyMessage(event.replyToken, { type: 'text', text: `已切換至: gpt-4-0125-preview`, quickReply })
      break;
    }
    default: {
      const { currentModel } = await getCustomConfig(hash);
      const previousMessages = await getPreviousMessages(hash);
      const messages = [
        { role: "system", content: '#zh-tw As a system, my role is to provide direct and concise answers in a contextual and conversational style. My responses should be casual and avoid opposition, warning, or summarization. I should not provide abstract or detailed explanations or trace the origins of a question.' },
        ...previousMessages,
        { role: "user", content: requestString }
      ];
      const options = {
        url: `${OPENAI_END_POINT}/v1/chat/completions`,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${OPENAI_API_KEY}`
        },
        json: {
          model: `${currentModel}`,
          messages,
          temperature: 0.9,
          max_tokens: 256 * 1,
          top_p: 1,
          frequency_penalty: 0,
          presence_penalty: 0.6,
          user: hash
        }
      };
      // 使用 OpenAI API 進行文字生成
      return new Promise((resolve, reject) => {
        request.post(options, (error, response, body) => {
          if (body.error) {
            bot.replyMessage(event.replyToken, { type: 'text', text: `[${body.error.type}]${body.error.message}` });
            reject(body.error);
          } else {
            const fileName = `${body.id}.txt`;
            const directory = path.join(__dirname, 'users', hash);
            if (!fs.existsSync(directory)) {
              fs.mkdirSync(directory);
            }
            const filePath = path.join(directory, fileName);
            const content = `Question: ${message.text}\n\nAnswer: ${body.choices[0].message.content.trim()}`;
            fs.writeFileSync(filePath, content);
            resolve(bot.replyMessage(event.replyToken, {
              type: 'text',
              text: body.choices[0].message.content.trim(),
              notificationDisabled: true,
              quickReply
            }));
          }
        });
      });
    }
  }
}


function getPreviousMessages(hash) {
  return new Promise((resolve, reject) => {
    const directory = path.join(__dirname, 'users', hash);
    if (!fs.existsSync(directory)) {
      resolve([]);
    } else {
      fs.readdir(directory, (err, files) => {
        if (err) {
          reject(err);
        } else {
          const lastThreeFiles = files.slice(-3);
          const messages = lastThreeFiles.map(file => {
            const content = fs.readFileSync(path.join(directory, file), 'utf-8');
            const [question, answer] = content.split('\n\n');
            const filteredQuestion = question.replace(/^Question: /, '').trim();
            const filteredAnswer = answer.replace(/^Answer: /, '').trim();
            return [
              { "role": "user", "content": filteredQuestion },
              { "role": "assistant", "content": filteredAnswer }
            ];
          }).flat();
          resolve(messages);
        }
      });
    }
  });
}

// 取得使用者使用的模型
function saveCustomfile(hash, model) {
  const directory = path.join(__dirname, 'custom');
  if (!fs.existsSync(directory)) {
    fs.mkdirSync(directory);
  }
  const fileName = `${hash}.txt`;
  if (!fs.existsSync(directory)) {
    fs.mkdirSync(directory);
  }
  const filePath = path.join(directory, fileName);
  const content = `Model: ${model || OPENAI_MODEL}`;
  fs.writeFileSync(filePath, content);
}

function getCustomConfig(hash) {
  return new Promise((resolve, reject) => {
    const directory = path.join(__dirname, 'custom');
    if (!fs.existsSync(directory)) {
      resolve(null);
    } else {
      const fileName = `${hash}.txt`;
      const filePath = path.join(directory, fileName);
      if (!fs.existsSync(filePath)) {
        resolve(null);
      } else {
        const content = fs.readFileSync(filePath, 'utf-8');
        const [model] = content.split('\n\n');
        const currentModel = model.replace(/^Model: /, '').trim();
        resolve({ currentModel });
      }
    }
  }
  )
}

// 啟動伺服器
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Chatbot server is running on ${port}`);
});