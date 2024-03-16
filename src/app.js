require('dotenv').config();
const express = require('express');
const line = require('@line/bot-sdk');
const request = require('request');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const CHANNEL_ACCESS_TOKEN = process.env.CHANNEL_ACCESS_TOKEN;
const CHANNEL_SECRET = process.env.CHANNEL_SECRET;
const OPENAI_END_POINT = process.env.OPENAI_END_POINT || 'https://api.openai.com';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-3.5-turbo';

// 建立 LINE Bot 物件
const config = {
  channelAccessToken: CHANNEL_ACCESS_TOKEN,
  channelSecret: CHANNEL_SECRET
};
const bot = new line.Client(config);

const quickReply = {
  items: [
    createQuickReplyItem("新話題", "!新話題"),
    createQuickReplyItem("model查詢", "!model查詢"),
    createQuickReplyItem("GPT-3.5", "!GPT-3.5-Turbo"),
    createQuickReplyItem("GPT-4-Turbo", "!GPT-4-Turbo"),
    createQuickReplyItem("製作圖片", "!製作圖片"),
  ]
};

function createQuickReplyItem(label, text) {
  return {
    type: "action",
    imageUrl: "https://th.bing.com/th?q=%e6%98%9f%e8%a1%97&w=42&h=42&c=7&rs=1&p=0&o=5&dpr=2&pid=1.7&mkt=zh-TW&cc=TW&setlang=zh-Hant&adlt=moderate&t=1",
    action: {
      type: "message",
      label: label,
      text: text
    }
  };
}

// 建立 Express 實例
const app = express();

// 設定 webhook 處理函式
app.post('/webhook', line.middleware(config), handleWebhook);

async function handleWebhook(req, res) {
  try {
    const results = await Promise.all(req.body.events.map(handleEvent));
    res.json(results);
  } catch (err) {
    console.error(err);
    res.status(500).end();
  }
}

// 處理每個事件
async function handleEvent(event) {
  const { type, message } = event;
  if (type !== 'message' || message.type !== 'text') {
    return null;
  }

  const userId = 'line_' + event.source.userId;
  const hash = crypto.createHash('sha256').update(userId).digest('hex');
  const requestString = message.text;

  switch (requestString) {
    case '!新話題':
      {
        const directory = path.join(__dirname, 'users', hash);
        const newDirectoryName = `[X]${hash}`;
        fs.renameSync(directory, path.join(__dirname, 'users', newDirectoryName));
        return bot.replyMessage(event.replyToken, { type: 'text', text: '新話題已開啟', quickReply });
      }
    case '!model查詢':
      {
        const { currentModel } = await getCustomConfig(hash);
        return bot.replyMessage(event.replyToken, { type: 'text', text: `目前使用: ${currentModel}`, quickReply });
      }
    case '!製作圖片':
      {
        saveCustomFile(hash, 'dall-e-3');
        return bot.replyMessage(event.replyToken, { type: 'text', text: '請輸入文字描述', quickReply });
      }
    case '!GPT-4-Turbo':
      {
        saveCustomFile(hash, 'gpt-4-turbo-preview');
        return bot.replyMessage(event.replyToken, { type: 'text', text: `已切換至: ${requestString.replace('!', '')}`, quickReply });
      }
    case '!GPT-3.5-Turbo':
    case '!GPT-4-0125-Preview':
      {
        saveCustomFile(hash, requestString.replace('!', '').toLowerCase());
        return bot.replyMessage(event.replyToken, { type: 'text', text: `已切換至: ${requestString.replace('!', '')}`, quickReply });
      }
    default:
      {
        const { currentModel } = await getCustomConfig(hash);
        if (currentModel === 'dall-e-3' && requestString.length > 0) {
          const imageGenerationResponse = await generateImage(requestString);
          if (imageGenerationResponse) {
            const imageUrl = imageGenerationResponse.data[0].url;
            const fileName = `${imageGenerationResponse.created}.txt`;
            const directory = path.join(__dirname, 'images', hash);
            if (!fs.existsSync(directory)) {
              fs.mkdirSync(directory);
            }
            const filePath = path.join(directory, fileName);
            const content = `User: ${userId}\n\nPrompt: ${requestString}\n\nImage: ${imageUrl}\n\nrevised_prompt: ${imageGenerationResponse.data[0].revised_prompt}`;
            fs.writeFileSync(filePath, content);

            bot.replyMessage(event.replyToken,
              {
                type: 'image', originalContentUrl: imageUrl, previewImageUrl: imageUrl, notificationDisabled: true,
                quickReply
              })
            // bot.replyMessage(event.replyToken,
            //   {
            //     type: 'text',
            //     text: `圖片生成成功\n${imageUrl}`,
            //     notificationDisabled: true,
            //     quickReply
            //   });
            return
          } else {
            return bot.replyMessage(event.replyToken, { type: 'text', text: '圖片生成失敗' });
          }
        }
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
            model: currentModel,
            messages,
            temperature: 0.9,
            max_tokens: 256 * 1,
            top_p: 1,
            frequency_penalty: 0,
            presence_penalty: 0.6,
            user: hash
          }
        };

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

async function getPreviousMessages(hash) {
  const directory = path.join(__dirname, 'users', hash);
  if (!fs.existsSync(directory)) {
    return [];
  } else {
    const files = fs.readdirSync(directory);
    const lastThreeFiles = files.slice(-3);
    const messages = lastThreeFiles.flatMap(file => {
      const content = fs.readFileSync(path.join(directory, file), 'utf-8');
      const [question, answer] = content.split('\n\n');
      const filteredQuestion = question.replace(/^Question: /, '').trim();
      const filteredAnswer = answer.replace(/^Answer: /, '').trim();
      return [
        { "role": "user", "content": filteredQuestion },
        { "role": "assistant", "content": filteredAnswer }
      ];
    });
    return messages;
  }
}

function saveCustomFile(hash, model) {
  const directory = path.join(__dirname, 'custom');
  if (!fs.existsSync(directory)) {
    fs.mkdirSync(directory);
  }
  const fileName = `${hash}.txt`;
  const filePath = path.join(directory, fileName);
  const content = `Model: ${model || OPENAI_MODEL}`;
  fs.writeFileSync(filePath, content);
}

async function getCustomConfig(hash) {
  const directory = path.join(__dirname, 'custom');
  if (!fs.existsSync(directory)) {
    return { currentModel: OPENAI_MODEL };
  } else {
    const fileName = `${hash}.txt`;
    const filePath = path.join(directory, fileName);
    if (!fs.existsSync(filePath)) {
      return { currentModel: OPENAI_MODEL };
    } else {
      const content = fs.readFileSync(filePath, 'utf-8');
      const [model] = content.split('\n\n');
      const currentModel = model.replace(/^Model: /, '').trim();
      return { currentModel };
    }
  }
}
async function generateImage(prompt) {
  return new Promise((resolve, reject) => {
    const options = {
      url: `${OPENAI_END_POINT}/v1/images/generations`,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`
      },
      json: {
        "model": "dall-e-3",
        "prompt": prompt,
        "n": 1,
        "size": "1024x1024"
      }
    };

    request.post(options, (error, response, body) => {
      if (error) {
        console.error(error);
        reject(error);
      } else {
        resolve(body);
      }
    });
  });
}

function postRequest(options) {
  return new Promise((resolve, reject) => {
    request.post(options, (error, response, body) => {
      if (error) {
        reject(error);
      } else {
        resolve({ response, body });
      }
    });
  });
}

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Chatbot 伺服器正在執行於 ${port} 連接埠`);
});
