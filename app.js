// ============================================================================
// AlfaComp AI — Telegram Mini App Application Logic
// ============================================================================

const CONFIG = {
  SUPABASE_URL: "https://ukekxtuqurnlcatfkzzd.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_3QFboaUTNtpYJcklH02Dog_gmW_A8eS",
  GEMINI_API_KEY: "AQ.Ab8RN6Jjy0aO8JEB4AMGlMMVPYt3AjnxknIWohNWifh8DoME-Q",
  GEMINI_MODEL: "gemini-2.0-flash",
  DEFAULT_CHANNEL: "@alfacomp_uz",
  MAX_HISTORY_TURNS: 20
};

// State
let currentUser = {
  id: null,
  name: "Пользователь",
  username: "",
  about: "",
  instructions: "",
  memory_notes: "",
  channel_username: CONFIG.DEFAULT_CHANNEL,
  deep_thinking: true,
  math_latex: true,
  human_style: true
};

let chatHistory = []; // { role: 'user' | 'model', content: string, timestamp: number }
let currentAttachment = null; // { base64: string, mimeType: string, filename: string }
let isGenerating = false;
let thinkingInterval = null;

// ============================================================================
// Initialization & Telegram WebApp SDK Integration
// ============================================================================
document.addEventListener("DOMContentLoaded", async () => {
  initLucide();
  initBackgroundCanvas();
  initTelegramWebApp();
  loadLocalUserSettings();
  await syncUserProfileFromSupabase();
  await loadChatHistoryFromSupabase();
  setupEventListeners();
  renderWelcomeState();
});

function initLucide() {
  if (window.lucide) {
    window.lucide.createIcons();
  }
}

function initTelegramWebApp() {
  const tg = window.Telegram?.WebApp;
  if (tg) {
    tg.ready();
    tg.expand();
    
    // Apply Telegram theme colors if available
    if (tg.headerColor) {
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', tg.headerColor);
    }

    if (tg.initDataUnsafe?.user) {
      const u = tg.initDataUnsafe.user;
      currentUser.id = u.id;
      currentUser.name = u.first_name + (u.last_name ? ` ${u.last_name}` : "");
      currentUser.username = u.username ? `@${u.username}` : "";
    }
  }

  // Fallback for standalone browser testing
  if (!currentUser.id) {
    let savedId = localStorage.getItem("alfacomp_user_id");
    if (!savedId) {
      savedId = "web_" + Math.floor(100000 + Math.random() * 900000);
      localStorage.setItem("alfacomp_user_id", savedId);
    }
    currentUser.id = savedId;
  }
}

function loadLocalUserSettings() {
  try {
    const local = localStorage.getItem("alfacomp_settings_" + currentUser.id);
    if (local) {
      const parsed = JSON.parse(local);
      currentUser = { ...currentUser, ...parsed };
    }
  } catch (e) {
    console.warn("Failed to load local settings", e);
  }
  updateUIWithUserSettings();
}

function updateUIWithUserSettings() {
  const greetingEl = document.getElementById("user-greeting-name");
  if (greetingEl) {
    greetingEl.textContent = currentUser.name || "друг";
  }

  const nameInput = document.getElementById("input-user-name");
  if (nameInput) nameInput.value = currentUser.name || "";

  const aboutInput = document.getElementById("input-user-about");
  if (aboutInput) aboutInput.value = currentUser.about || "";

  const instructionsInput = document.getElementById("input-user-instructions");
  if (instructionsInput) instructionsInput.value = currentUser.instructions || "";

  const memoryInput = document.getElementById("input-memory-notes");
  if (memoryInput) memoryInput.value = currentUser.memory_notes || "";

  const channelInput = document.getElementById("input-channel-username");
  if (channelInput) channelInput.value = currentUser.channel_username || CONFIG.DEFAULT_CHANNEL;

  const headerChannelName = document.getElementById("header-channel-name");
  if (headerChannelName) headerChannelName.textContent = `Канал: ${currentUser.channel_username || CONFIG.DEFAULT_CHANNEL}`;

  const channelLinkBtn = document.getElementById("channel-link-btn");
  if (channelLinkBtn) {
    const ch = (currentUser.channel_username || CONFIG.DEFAULT_CHANNEL).replace("@", "");
    channelLinkBtn.href = `https://t.me/${ch}`;
  }

  const deepCheck = document.getElementById("toggle-deep-thinking");
  if (deepCheck) deepCheck.checked = currentUser.deep_thinking !== false;

  const latexCheck = document.getElementById("toggle-latex-rendering");
  if (latexCheck) latexCheck.checked = currentUser.math_latex !== false;

  const humanCheck = document.getElementById("toggle-human-style");
  if (humanCheck) humanCheck.checked = currentUser.human_style !== false;
}

// ============================================================================
// Supabase Sync (User Profile & Chat History)
// ============================================================================
async function syncUserProfileFromSupabase() {
  if (!currentUser.id) return;
  try {
    // If ID is numeric (from Telegram)
    const numericId = parseInt(currentUser.id, 10);
    if (isNaN(numericId)) return;

    const res = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/user_ai_profiles?user_id=eq.${numericId}&select=*`, {
      headers: {
        "apikey": CONFIG.SUPABASE_ANON_KEY,
        "Authorization": `Bearer ${CONFIG.SUPABASE_ANON_KEY}`
      }
    });

    if (res.ok) {
      const data = await res.json();
      if (data && data.length > 0) {
        const p = data[0];
        currentUser.name = p.name || currentUser.name;
        currentUser.about = p.about || currentUser.about;
        currentUser.instructions = p.instructions || currentUser.instructions;
        currentUser.memory_notes = p.memory_notes || currentUser.memory_notes;
        currentUser.channel_username = p.channel_username || currentUser.channel_username;
        if (p.settings) {
          currentUser.deep_thinking = p.settings.deep_thinking ?? currentUser.deep_thinking;
          currentUser.math_latex = p.settings.math_latex ?? currentUser.math_latex;
          currentUser.human_style = p.settings.human_style ?? currentUser.human_style;
        }
        updateUIWithUserSettings();
      }
    }
  } catch (err) {
    console.warn("Could not sync user profile from Supabase:", err);
  }
}

async function saveUserProfileToSupabase() {
  localStorage.setItem("alfacomp_settings_" + currentUser.id, JSON.stringify(currentUser));
  updateUIWithUserSettings();

  const numericId = parseInt(currentUser.id, 10);
  if (isNaN(numericId)) return;

  try {
    await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/user_ai_profiles`, {
      method: "POST",
      headers: {
        "apikey": CONFIG.SUPABASE_ANON_KEY,
        "Authorization": `Bearer ${CONFIG.SUPABASE_ANON_KEY}`,
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates"
      },
      body: JSON.stringify({
        user_id: numericId,
        name: currentUser.name,
        username: currentUser.username,
        about: currentUser.about,
        instructions: currentUser.instructions,
        memory_notes: currentUser.memory_notes,
        channel_username: currentUser.channel_username,
        settings: {
          deep_thinking: currentUser.deep_thinking,
          math_latex: currentUser.math_latex,
          human_style: currentUser.human_style
        },
        updated_at: new Date().toISOString()
      })
    });
  } catch (err) {
    console.warn("Could not save profile to Supabase:", err);
  }
}

async function loadChatHistoryFromSupabase() {
  const numericId = parseInt(currentUser.id, 10);
  if (isNaN(numericId)) return;

  try {
    const res = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/ai_chat_history?user_id=eq.${numericId}&order=created_at.asc&limit=30`, {
      headers: {
        "apikey": CONFIG.SUPABASE_ANON_KEY,
        "Authorization": `Bearer ${CONFIG.SUPABASE_ANON_KEY}`
      }
    });

    if (res.ok) {
      const rows = await res.json();
      if (rows && rows.length > 0) {
        chatHistory = rows.map(r => ({
          role: r.role,
          content: r.content,
          timestamp: new Date(r.created_at).getTime()
        }));
        renderAllMessages();
      }
    }
  } catch (err) {
    console.warn("Could not load chat history:", err);
  }
}

async function appendMessageToHistory(role, content) {
  chatHistory.push({
    role,
    content,
    timestamp: Date.now()
  });

  const numericId = parseInt(currentUser.id, 10);
  if (!isNaN(numericId)) {
    try {
      fetch(`${CONFIG.SUPABASE_URL}/rest/v1/ai_chat_history`, {
        method: "POST",
        headers: {
          "apikey": CONFIG.SUPABASE_ANON_KEY,
          "Authorization": `Bearer ${CONFIG.SUPABASE_ANON_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          user_id: numericId,
          role: role,
          content: content
        })
      }).catch(() => {});
    } catch (_) {}
  }
}

// ============================================================================
// UI & Message Rendering with KaTeX Math & Markdown Code Blocks
// ============================================================================
function renderWelcomeState() {
  const hero = document.getElementById("welcome-hero");
  if (!hero) return;
  if (chatHistory.length > 0) {
    hero.classList.add("hidden");
  } else {
    hero.classList.remove("hidden");
  }
}

function renderAllMessages() {
  const container = document.getElementById("chat-messages");
  if (!container) return;
  container.innerHTML = "";
  chatHistory.forEach(msg => appendMessageUI(msg.role, msg.content, false));
  renderWelcomeState();
  scrollToBottom();
}

function appendMessageUI(role, text, shouldScroll = true, attachedImageBase64 = null) {
  const container = document.getElementById("chat-messages");
  if (!container) return;

  const row = document.createElement("div");
  row.className = `message-row ${role === "user" ? "user" : "ai"}`;

  const avatar = document.createElement("div");
  avatar.className = "msg-avatar";
  avatar.innerHTML = role === "user" ? '<i data-lucide="user"></i>' : '<i data-lucide="sparkles"></i>';

  const bubble = document.createElement("div");
  bubble.className = "msg-bubble";

  // If image attached
  if (attachedImageBase64) {
    const imgEl = document.createElement("img");
    imgEl.src = attachedImageBase64;
    imgEl.className = "msg-attached-img";
    imgEl.alt = "Прикрепленное изображение";
    bubble.appendChild(imgEl);
  }

  // Content wrapper
  const textDiv = document.createElement("div");
  textDiv.className = "msg-text-content";

  if (role === "user") {
    textDiv.textContent = text;
  } else {
    // Parse Markdown and format code blocks
    textDiv.innerHTML = formatMarkdownWithCodeBlocks(text);
  }

  bubble.appendChild(textDiv);

  // Time stamp
  const timeEl = document.createElement("span");
  timeEl.className = "msg-time";
  const now = new Date();
  timeEl.textContent = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
  bubble.appendChild(timeEl);

  row.appendChild(avatar);
  row.appendChild(bubble);
  container.appendChild(row);

  // Apply KaTeX Math rendering
  if (currentUser.math_latex !== false && window.renderMathInElement) {
    try {
      window.renderMathInElement(bubble, {
        delimiters: [
          { left: "$$", right: "$$", display: true },
          { left: "$", right: "$", display: false },
          { left: "\\[", right: "\\]", display: true },
          { left: "\\(", right: "\\)", display: false }
        ],
        throwOnError: false
      });
    } catch (e) {
      console.warn("KaTeX rendering warning:", e);
    }
  }

  initLucide();
  renderWelcomeState();

  if (shouldScroll) {
    scrollToBottom();
  }
}

function scrollToBottom() {
  const container = document.querySelector(".main-content");
  if (container) {
    setTimeout(() => {
      container.scrollTop = container.scrollHeight;
    }, 50);
  }
}

// ============================================================================
// Markdown Parser & Interactive Code Block Wrapper (Copy / Download / Preview)
// ============================================================================
function formatMarkdownWithCodeBlocks(rawText) {
  if (!rawText) return "";

  // Use marked.js if available
  let html = rawText;
  if (window.marked) {
    marked.setOptions({
      breaks: true,
      gfm: true
    });
    html = marked.parse(rawText);
  }

  // Wrap code blocks into our interactive component
  const tempDiv = document.createElement("div");
  tempDiv.innerHTML = html;

  const pres = tempDiv.querySelectorAll("pre");
  pres.forEach((pre) => {
    const code = pre.querySelector("code");
    const codeText = code ? code.innerText : pre.innerText;
    let lang = "code";
    if (code && code.className) {
      const match = code.className.match(/language-(\w+)/);
      if (match) lang = match[1];
    }

    const isWebCode = ["html", "css", "js", "javascript"].includes(lang.toLowerCase()) || 
                      codeText.includes("<!DOCTYPE") || 
                      (codeText.includes("<html") && codeText.includes("</html>"));

    const wrapper = document.createElement("div");
    wrapper.className = "code-block-wrapper";

    const header = document.createElement("div");
    header.className = "code-header";

    const left = document.createElement("div");
    left.className = "code-header-left";
    left.style.display = "flex";
    left.style.alignItems = "center";
    left.style.gap = "8px";
    left.innerHTML = `
      <div class="code-dots">
        <span class="code-dot dot-red"></span>
        <span class="code-dot dot-yellow"></span>
        <span class="code-dot dot-green"></span>
      </div>
      <span class="code-lang-badge">${lang}</span>
    `;

    const actions = document.createElement("div");
    actions.className = "code-actions";

    // Copy Button
    const btnCopy = document.createElement("button");
    btnCopy.className = "btn-code-action btn-copy";
    btnCopy.innerHTML = '<i data-lucide="copy" class="icon-xs"></i> <span>Копировать</span>';
    btnCopy.onclick = () => copyCodeToClipboard(codeText, btnCopy);
    actions.appendChild(btnCopy);

    // Download Button
    const btnDownload = document.createElement("button");
    btnDownload.className = "btn-code-action btn-download";
    btnDownload.innerHTML = '<i data-lucide="download" class="icon-xs"></i> <span>Скачать</span>';
    btnDownload.onclick = () => downloadCodeFile(codeText, lang);
    actions.appendChild(btnDownload);

    // Live Web Preview Button (if HTML/CSS/JS)
    if (isWebCode) {
      const btnPreview = document.createElement("button");
      btnPreview.className = "btn-code-action btn-code-preview";
      btnPreview.innerHTML = '<i data-lucide="play" class="icon-xs"></i> <span>Запустить сайт</span>';
      btnPreview.onclick = () => openLivePreviewModal(codeText, lang);
      actions.appendChild(btnPreview);
    }

    header.appendChild(left);
    header.appendChild(actions);

    wrapper.appendChild(header);

    const newPre = document.createElement("pre");
    newPre.className = "code-content";
    const newCode = document.createElement("code");
    newCode.className = code?.className || `language-${lang}`;
    newCode.textContent = codeText;
    newPre.appendChild(newCode);

    wrapper.appendChild(newPre);
    pre.parentNode.replaceChild(wrapper, pre);
  });

  return tempDiv.innerHTML;
}

function copyCodeToClipboard(text, btn) {
  navigator.clipboard.writeText(text).then(() => {
    btn.innerHTML = '<i data-lucide="check" class="icon-xs"></i> <span>Скопировано!</span>';
    showToast("Код успешно скопирован в буфер обмена!");
    initLucide();
    setTimeout(() => {
      btn.innerHTML = '<i data-lucide="copy" class="icon-xs"></i> <span>Копировать</span>';
      initLucide();
    }, 2000);
  }).catch(() => {
    showToast("Не удалось скопировать код");
  });
}

function downloadCodeFile(codeText, lang) {
  const extMap = {
    html: "html",
    css: "css",
    js: "js",
    javascript: "js",
    python: "py",
    py: "py",
    typescript: "ts",
    ts: "ts",
    json: "json",
    sql: "sql",
    bash: "sh",
    shell: "sh"
  };
  const ext = extMap[lang.toLowerCase()] || "txt";
  const filename = `code_${Date.now()}.${ext}`;

  const blob = new Blob([codeText], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast(`Файл ${filename} сохранен!`);
}

// ============================================================================
// Live Web Preview (Sandboxed iframe for HTML/CSS/JS)
// ============================================================================
function openLivePreviewModal(code, lang) {
  const modal = document.getElementById("preview-modal");
  const iframe = document.getElementById("preview-iframe");
  if (!modal || !iframe) return;

  let fullHtml = code;
  if (!code.includes("<html") && !code.includes("<!DOCTYPE")) {
    if (lang === "css") {
      fullHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${code}</style></head><body><h1>Тестирование CSS стилей</h1><div class="box">Элемент для проверки стилей</div></body></html>`;
    } else if (lang === "js" || lang === "javascript") {
      fullHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body><h1>Запуск JavaScript</h1><div id="app"></div><script>${code}<\/script></body></html>`;
    } else {
      fullHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@picocss/pico@1/css/pico.min.css"></head><body>${code}</body></html>`;
    }
  }

  iframe.srcdoc = fullHtml;
  modal.classList.remove("hidden");
  initLucide();
}

function closeLivePreviewModal() {
  const modal = document.getElementById("preview-modal");
  const iframe = document.getElementById("preview-iframe");
  if (iframe) iframe.srcdoc = "about:blank";
  if (modal) modal.classList.add("hidden");
}

// ============================================================================
// AI API Request with Long-Term Memory, System Prompt & Multi-Turn History
// ============================================================================
async function sendUserMessage() {
  if (isGenerating) return;
  const inputEl = document.getElementById("chat-input");
  const text = (inputEl ? inputEl.value : "").trim();

  if (!text && !currentAttachment) return;

  const userText = text;
  const attachedBase64 = currentAttachment ? currentAttachment.base64 : null;
  const attachedMime = currentAttachment ? currentAttachment.mimeType : "image/jpeg";

  // Clear input
  if (inputEl) {
    inputEl.value = "";
    inputEl.style.height = "auto";
  }
  clearAttachment();

  // Render user message
  appendMessageUI("user", userText || "[Фотография отправлена на анализ]", true, attachedBase64);
  await appendMessageToHistory("user", userText || "[Фотография отправлена на анализ]");

  // Show thinking indicator with stages
  showThinkingIndicator(Boolean(attachedBase64));

  try {
    isGenerating = true;
    const aiResponse = await callGeminiAI(userText, attachedBase64, attachedMime);
    hideThinkingIndicator();
    appendMessageUI("model", aiResponse, true);
    await appendMessageToHistory("model", aiResponse);

    // Periodically update user memory if new facts were provided
    extractAndSaveMemoryFacts(userText, aiResponse);
  } catch (err) {
    hideThinkingIndicator();
    appendMessageUI("model", `⚠️ Произошла ошибка при обращении к ИИ: ${err.message || err}`, true);
  } finally {
    isGenerating = false;
  }
}

async function callGeminiAI(prompt, imageBase64, mimeType) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${CONFIG.GEMINI_MODEL}:generateContent?key=${CONFIG.GEMINI_API_KEY}`;

  // Build System Instruction with User Memory
  const systemInstructionText = `
Ты — персональный, высокоинтеллектуальный ИИ-ассистент AlfaComp.
ТВОЙ СТИЛЬ:
- Общайся как живой, умный, тактичный человек-эксперт.
- КАТЕГОРИЧЕСКИ ЗАПРЕЩЕНО использовать роботизированные шаблоны («Я как языковая модель...», «Я искусственный интеллект, созданный Google...»).
- Твои ответы должны быть глубокими, исчерпывающими, логичными и доведенными до конца, без спешки.

ДАННЫЕ О ПОЛЬЗОВАТЕЛЕ (ПОМНИ ВСЕГДА):
- Имя/обращение: ${currentUser.name || 'Пользователь'}
- О пользователе: ${currentUser.about || 'Пользователь AlfaComp'}
- Персональные пожелания пользователя: ${currentUser.instructions || 'Отвечать профессионально и понятно'}
- Долговременная память (зафиксированные факты): ${currentUser.memory_notes || 'Пользователь общается в Telegram и Mini App'}
- Подключенный канал: ${currentUser.channel_username || CONFIG.DEFAULT_CHANNEL}

ПРАВИЛА ОФОРМЛЕНИЯ МАТЕМАТИКИ:
В математических выражениях и задачах ВСЕГДА используй стандартный синтаксис LaTeX:
1. Степени и индексы: $x^2$, $x^{10}$, $x_1$, $x_{max}$.
2. Дроби и корни: $\\frac{a+b}{2}$, $\\sqrt{x}$, $\\sqrt[3]{x}$.
3. Знаки: $\\times$, $\\cdot$, $\\div$, $\\pm$, $\\neq$, $\\approx$, $\\le$, $\\ge$.
4. Скобки: используй \\left( \\right), чтобы скобки подстраивались под высоту дробей.
5. Греческие буквы: \\alpha, \\beta, \\gamma, \\Delta, \\delta, \\pi, \\sigma.
6. Продвинутые конструкции: суммы $\\sum_{i=1}^{n} i$, интегралы $\\int_{0}^{1} x^2 dx$, пределы $\\lim_{x \\to 0}$.

ПРАВИЛА ОФОРМЛЕНИЯ КОДА:
- Любой программный код оформляй в Markdown-блоках с обязательным указанием языка (\`\`\`html, \`\`\`css, \`\`\`javascript, \`\`\`python и т.д.).
- Если пользователь просит создать сайт или интерфейс, выдавай полноценный, готовый код (HTML, CSS, JS), чтобы его можно было запустить и протестировать в iFrame предпросмотре!
`;

  // Build multi-turn contents from history
  const contents = [];
  const recentTurns = chatHistory.slice(-CONFIG.MAX_HISTORY_TURNS);

  for (const item of recentTurns) {
    contents.push({
      role: item.role === "user" ? "user" : "model",
      parts: [{ text: item.content }]
    });
  }

  // Current turn
  const currentParts = [];
  if (imageBase64) {
    // Remove data URL prefix if present
    const cleanBase64 = imageBase64.replace(/^data:image\/\w+;base64,/, "");
    currentParts.push({
      inlineData: {
        mimeType: mimeType || "image/jpeg",
        data: cleanBase64
      }
    });
  }
  currentParts.push({ text: prompt || "Привет! Чем я могу помочь?" });

  contents.push({
    role: "user",
    parts: currentParts
  });

  const bodyPayload = {
    systemInstruction: {
      parts: [{ text: systemInstructionText }]
    },
    contents: contents,
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 8192 // No cutoffs!
    }
  };

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(bodyPayload)
  });

  const data = await response.json();
  if (data.candidates && data.candidates[0]?.content?.parts?.[0]?.text) {
    return data.candidates[0].content.parts[0].text;
  }
  if (data.error) {
    throw new Error(data.error.message);
  }
  return "🤖 ИИ не вернул ответ. Попробуйте еще раз.";
}

// Background auto-extraction of facts about the user
function extractAndSaveMemoryFacts(userText, aiReply) {
  if (!userText || userText.length < 15) return;
  // If user shares personal facts like "меня зовут...", "я работаю...", "я люблю..."
  const personalKeywords = ["меня зовут", "мое имя", "я работаю", "я учусь", "мой проект", "мой канал", "я люблю", "мне нравится", "я живу в"];
  const lower = userText.toLowerCase();
  const hasFact = personalKeywords.some(kw => lower.includes(kw));

  if (hasFact) {
    const newNote = `• ${userText}`;
    if (!currentUser.memory_notes.includes(userText)) {
      currentUser.memory_notes = currentUser.memory_notes ? `${currentUser.memory_notes}\n${newNote}` : newNote;
      saveUserProfileToSupabase();
    }
  }
}

// ============================================================================
// Thinking Indicator Animations
// ============================================================================
function showThinkingIndicator(hasPhoto = false) {
  const el = document.getElementById("thinking-indicator");
  const title = document.getElementById("thinking-stage-title");
  const sub = document.getElementById("thinking-stage-sub");
  if (!el || !title || !sub) return;

  el.classList.remove("hidden");
  scrollToBottom();

  const stages = hasPhoto ? [
    { t: "🔬 Gemini Vision сканирует изображение...", s: "Распознавание объектов, текста и деталей (2–4 минуты)..." },
    { t: "🧠 Глубокий визуальный анализ...", s: "Построение взаимосвязей и проверка гипотез..." },
    { t: "📐 Точная обработка данных...", s: "Формирование исчерпывающего аналитического отчета..." },
    { t: "✨ Завершение ответа...", s: "Финальная верстка и проверка качества..." }
  ] : [
    { t: "⚡ Анализирую условие задачи...", s: "Выделение ключевых переменных и требований..." },
    { t: "📐 Математическая строгость и формулы...", s: "Вычисление степеней, дробей, корней и интегралов в LaTeX..." },
    { t: "🧠 Глубокая логическая проработка...", s: "ИИ готовит максимально развернутый и точный ответ (1–2 минуты)..." },
    { t: "✨ Оформляю завершенный ответ...", s: "Форматирование кода и формул для идеального отображения..." }
  ];

  let step = 0;
  title.textContent = stages[0].t;
  sub.textContent = stages[0].s;

  if (thinkingInterval) clearInterval(thinkingInterval);
  thinkingInterval = setInterval(() => {
    step = (step + 1) % stages.length;
    title.textContent = stages[step].t;
    sub.textContent = stages[step].s;
  }, 7000);
}

function hideThinkingIndicator() {
  const el = document.getElementById("thinking-indicator");
  if (el) el.classList.add("hidden");
  if (thinkingInterval) {
    clearInterval(thinkingInterval);
    thinkingInterval = null;
  }
}

// ============================================================================
// Attachments Handling
// ============================================================================
function handleFileInput(e) {
  const file = e.target.files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (event) => {
    const base64 = event.target.result;
    currentAttachment = {
      base64: base64,
      mimeType: file.type || "image/jpeg",
      filename: file.name
    };

    const container = document.getElementById("attachment-preview-container");
    const imgEl = document.getElementById("preview-img");
    if (container && imgEl) {
      imgEl.src = base64;
      container.classList.remove("hidden");
    }
  };
  reader.readAsDataURL(file);
}

function clearAttachment() {
  currentAttachment = null;
  const container = document.getElementById("attachment-preview-container");
  const fileInput = document.getElementById("file-input");
  if (container) container.classList.add("hidden");
  if (fileInput) fileInput.value = "";
}

// ============================================================================
// New Chat (Clears view, but RETAINS Long-Term Memory & User Profile)
// ============================================================================
function startNewChat() {
  chatHistory = [];
  const container = document.getElementById("chat-messages");
  if (container) container.innerHTML = "";
  renderWelcomeState();
  showToast(`Диалог очищен. Память о вас (${currentUser.name}) полностью сохранена!`);

  // Send a friendly greeting message acknowledging memory
  setTimeout(() => {
    appendMessageUI(
      "model",
      `Привет, **${currentUser.name || 'друг'}**! Начинаем новый диалог. Я по-прежнему помню все ваши настройки, предпочтения и задачи. Чем займемся сегодня?`
    );
  }, 300);
}

// ============================================================================
// Settings Modal & Tabs
// ============================================================================
function openSettingsModal() {
  const modal = document.getElementById("settings-modal");
  if (modal) {
    updateUIWithUserSettings();
    modal.classList.remove("hidden");
    initLucide();
  }
}

function closeSettingsModal() {
  const modal = document.getElementById("settings-modal");
  if (modal) modal.classList.add("hidden");
}

function saveSettingsFromUI() {
  const nameInput = document.getElementById("input-user-name");
  const aboutInput = document.getElementById("input-user-about");
  const instructionsInput = document.getElementById("input-user-instructions");
  const memoryInput = document.getElementById("input-memory-notes");
  const channelInput = document.getElementById("input-channel-username");
  const deepCheck = document.getElementById("toggle-deep-thinking");
  const latexCheck = document.getElementById("toggle-latex-rendering");
  const humanCheck = document.getElementById("toggle-human-style");

  if (nameInput) currentUser.name = nameInput.value.trim() || currentUser.name;
  if (aboutInput) currentUser.about = aboutInput.value.trim();
  if (instructionsInput) currentUser.instructions = instructionsInput.value.trim();
  if (memoryInput) currentUser.memory_notes = memoryInput.value.trim();
  if (channelInput) currentUser.channel_username = channelInput.value.trim();
  if (deepCheck) currentUser.deep_thinking = deepCheck.checked;
  if (latexCheck) currentUser.math_latex = latexCheck.checked;
  if (humanCheck) currentUser.human_style = humanCheck.checked;

  saveUserProfileToSupabase();
  closeSettingsModal();
  showToast("Настройки и память успешно сохранены!");
}

function clearMemoryNotes() {
  if (confirm("Вы уверены, что хотите очистить накопленные факты долговременной памяти?")) {
    currentUser.memory_notes = "";
    const memoryInput = document.getElementById("input-memory-notes");
    if (memoryInput) memoryInput.value = "";
    saveUserProfileToSupabase();
    showToast("Память очищена.");
  }
}

// ============================================================================
// Voice Input: MediaRecorder → Gemini Audio API (primary) + SpeechRecognition fallback
// ============================================================================
let voiceMediaRecorder = null;
let voiceAudioChunks = [];
let voiceRecordingActive = false;

async function initVoiceInput() {
  const btnVoice = document.getElementById("btn-voice");

  // If already recording — STOP
  if (voiceRecordingActive) {
    if (voiceMediaRecorder && voiceMediaRecorder.state === "recording") {
      voiceMediaRecorder.stop();
    }
    return;
  }

  // Try MediaRecorder (best: sends real audio to Gemini)
  if (navigator.mediaDevices && window.MediaRecorder) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      voiceAudioChunks = [];
      voiceRecordingActive = true;

      if (btnVoice) {
        btnVoice.classList.add("voice-recording");
        btnVoice.title = "Запись... Нажмите еще раз чтобы остановить";
      }
      showToast("🎤 Запись... Нажмите кнопку еще раз чтобы отправить");

      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "audio/ogg";

      voiceMediaRecorder = new MediaRecorder(stream, { mimeType });

      voiceMediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) voiceAudioChunks.push(e.data);
      };

      voiceMediaRecorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        voiceRecordingActive = false;
        if (btnVoice) {
          btnVoice.classList.remove("voice-recording");
          btnVoice.title = "Голосовой ввод";
        }

        const blob = new Blob(voiceAudioChunks, { type: mimeType });
        if (blob.size < 500) {
          showToast("Запись пустая. Попробуйте ещё раз.");
          return;
        }

        // Convert blob to base64
        const reader = new FileReader();
        reader.onloadend = async () => {
          const base64Audio = reader.result.split(",")[1];
          const geminiMime = mimeType.startsWith("audio/webm") ? "audio/webm" : "audio/ogg";

          showToast("🧠 Gemini анализирует ваш голос...");
          showThinkingIndicator(false);

          try {
            isGenerating = true;
            const url = `https://generativelanguage.googleapis.com/v1beta/models/${CONFIG.GEMINI_MODEL}:generateContent?key=${CONFIG.GEMINI_API_KEY}`;

            const systemText = `Ты — персональный ИИ-ассистент AlfaComp.
ДАННЫЕ О ПОЛЬЗОВАТЕЛЕ: Имя: ${currentUser.name || 'Пользователь'}. ${currentUser.about ? 'О себе: ' + currentUser.about : ''}
Пользователь отправил ГОЛОСОВОЕ СООБЩЕНИЕ.
Сначала напиши на отдельной строке: 🎤 Вы сказали: "расшифровка"
Затем дай полный, развёрнутый ответ.
${currentUser.instructions ? 'Персональные пожелания: ' + currentUser.instructions : ''}`;

            // Build history + audio message
            const contents = [];
            const recentTurns = chatHistory.slice(-CONFIG.MAX_HISTORY_TURNS);
            for (const item of recentTurns) {
              contents.push({ role: item.role === "user" ? "user" : "model", parts: [{ text: item.content }] });
            }
            contents.push({
              role: "user",
              parts: [
                { inline_data: { mime_type: geminiMime, data: base64Audio } },
                { text: "Расшифруй голосовое сообщение и ответь." }
              ]
            });

            const bodyPayload = {
              systemInstruction: { parts: [{ text: systemText }] },
              contents,
              generationConfig: { temperature: 0.7, maxOutputTokens: 8192 }
            };

            const response = await fetch(url, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(bodyPayload)
            });
            const data = await response.json();
            hideThinkingIndicator();

            if (data.candidates?.[0]?.content?.parts?.[0]?.text) {
              const aiText = data.candidates[0].content.parts[0].text;
              appendMessageUI("user", "[🎤 Голосовое сообщение]", true);
              await appendMessageToHistory("user", "[Голосовое сообщение]");
              appendMessageUI("model", aiText, true);
              await appendMessageToHistory("model", aiText);
            } else if (data.error) {
              throw new Error(data.error.message);
            } else {
              hideThinkingIndicator();
              showToast("Не удалось распознать голос. Попробуйте ещё раз.");
            }
          } catch (err) {
            hideThinkingIndicator();
            appendMessageUI("model", `⚠️ Ошибка распознавания голоса: ${err.message || err}`, true);
          } finally {
            isGenerating = false;
          }
        };
        reader.readAsDataURL(blob);
      };

      voiceMediaRecorder.start(500); // collect data every 500ms
      return;
    } catch (err) {
      // Microphone access denied or not available — fall through to SpeechRecognition
      console.warn("MediaRecorder failed, trying SpeechRecognition:", err);
    }
  }

  // Fallback: SpeechRecognition (Chrome/Edge, transcribes to text only)
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    showToast("Нет доступа к микрофону и голосовой ввод не поддерживается браузером.");
    return;
  }

  const recognition = new SpeechRecognition();
  recognition.lang = "ru-RU";
  recognition.interimResults = false;

  if (btnVoice) btnVoice.classList.add("voice-recording");
  showToast("🎤 Слушаю... Говорите!");

  recognition.onresult = (event) => {
    const transcript = event.results[0][0].transcript;
    const input = document.getElementById("chat-input");
    if (input) {
      input.value = (input.value ? input.value + " " : "") + transcript;
    }
    showToast(`💬 Распознано: "${transcript}"`);
  };

  recognition.onerror = () => {
    showToast("Не удалось распознать речь.");
  };

  recognition.onend = () => {
    if (btnVoice) btnVoice.classList.remove("voice-recording");
    voiceRecordingActive = false;
  };

  voiceRecordingActive = true;
  recognition.start();
}

// ============================================================================
// Event Listeners Setup
// ============================================================================
function setupEventListeners() {
  // Send Button
  document.getElementById("btn-send")?.addEventListener("click", sendUserMessage);

  // Enter to send (Shift+Enter for newline)
  const chatInput = document.getElementById("chat-input");
  if (chatInput) {
    chatInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendUserMessage();
      }
    });

    // Auto resize
    chatInput.addEventListener("input", () => {
      chatInput.style.height = "auto";
      chatInput.style.height = Math.min(chatInput.scrollHeight, 150) + "px";
      const counter = document.getElementById("char-counter");
      if (counter) counter.textContent = `${chatInput.value.length} / 8000`;
    });
  }

  // File input
  document.getElementById("file-input")?.addEventListener("change", handleFileInput);
  document.getElementById("btn-remove-attachment")?.addEventListener("click", clearAttachment);

  // Voice button
  document.getElementById("btn-voice")?.addEventListener("click", initVoiceInput);

  // New Chat button
  document.getElementById("btn-new-chat")?.addEventListener("click", startNewChat);

  // Settings
  document.getElementById("btn-open-settings")?.addEventListener("click", openSettingsModal);
  document.getElementById("btn-settings-close")?.addEventListener("click", closeSettingsModal);
  document.getElementById("btn-save-settings")?.addEventListener("click", saveSettingsFromUI);
  document.getElementById("btn-clear-memory")?.addEventListener("click", clearMemoryNotes);

  // Settings tabs navigation
  document.querySelectorAll(".settings-tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".settings-tab-btn").forEach(b => b.classList.remove("active"));
      document.querySelectorAll(".tab-pane").forEach(p => p.classList.remove("active"));
      btn.classList.add("active");
      const target = document.getElementById(btn.getAttribute("data-tab"));
      if (target) target.classList.add("active");
      initLucide();
    });
  });

  // Quick Chips
  document.querySelectorAll(".chip").forEach(chip => {
    chip.addEventListener("click", () => {
      const prompt = chip.getAttribute("data-prompt");
      const input = document.getElementById("chat-input");
      if (input && prompt) {
        input.value = prompt;
        input.focus();
      }
    });
  });

  // Live Preview Modal Close
  document.getElementById("btn-preview-close")?.addEventListener("click", closeLivePreviewModal);
  document.getElementById("btn-preview-refresh")?.addEventListener("click", () => {
    const iframe = document.getElementById("preview-iframe");
    if (iframe) iframe.srcdoc = iframe.srcdoc;
  });
  document.getElementById("btn-preview-open-tab")?.addEventListener("click", () => {
    const iframe = document.getElementById("preview-iframe");
    if (iframe && iframe.srcdoc) {
      const blob = new Blob([iframe.srcdoc], { type: "text/html" });
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank");
    }
  });

  // Channel post generator button inside settings
  document.getElementById("btn-gen-channel-post")?.addEventListener("click", () => {
    closeSettingsModal();
    const prompt = `Напиши готовый экспертный пост для нашего Telegram-канала ${currentUser.channel_username || CONFIG.DEFAULT_CHANNEL}. Тема: современные технологии, ИИ и полезные советы. Добавь заголовок, эмодзи, списки и вовлекающий вопрос для аудитории.`;
    const input = document.getElementById("chat-input");
    if (input) {
      input.value = prompt;
      sendUserMessage();
    }
  });
}

// Toast notification
function showToast(message) {
  const container = document.getElementById("toast-container");
  if (!container) return;

  const toast = document.createElement("div");
  toast.className = "toast";
  toast.innerHTML = `<i data-lucide="info" class="icon-xs"></i> <span>${message}</span>`;
  container.appendChild(toast);
  initLucide();

  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateY(-10px)";
    toast.style.transition = "all 0.3s ease";
    setTimeout(() => toast.remove(), 300);
  }, 3200);
}

// ============================================================================
// Dynamic Animated Canvas Background
// ============================================================================
function initBackgroundCanvas() {
  const canvas = document.getElementById("bg-canvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");

  let width = (canvas.width = window.innerWidth);
  let height = (canvas.height = window.innerHeight);

  window.addEventListener("resize", () => {
    width = canvas.width = window.innerWidth;
    height = canvas.height = window.innerHeight;
  });

  const particles = [];
  const particleCount = Math.floor(Math.min(width, height) / 22);

  for (let i = 0; i < particleCount; i++) {
    particles.push({
      x: Math.random() * width,
      y: Math.random() * height,
      vx: (Math.random() - 0.5) * 0.4,
      vy: (Math.random() - 0.5) * 0.4,
      radius: Math.random() * 2 + 1,
      alpha: Math.random() * 0.5 + 0.2
    });
  }

  function draw() {
    ctx.clearRect(0, 0, width, height);

    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      p.x += p.vx;
      p.y += p.vy;

      if (p.x < 0) p.x = width;
      if (p.x > width) p.x = 0;
      if (p.y < 0) p.y = height;
      if (p.y > height) p.y = 0;

      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(99, 102, 241, ${p.alpha * 0.5})`;
      ctx.fill();

      // Connect near particles
      for (let j = i + 1; j < particles.length; j++) {
        const p2 = particles[j];
        const dist = Math.hypot(p.x - p2.x, p.y - p2.y);
        if (dist < 110) {
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p2.x, p2.y);
          ctx.strokeStyle = `rgba(6, 182, 212, ${(1 - dist / 110) * 0.15})`;
          ctx.lineWidth = 0.8;
          ctx.stroke();
        }
      }
    }

    requestAnimationFrame(draw);
  }

  draw();
}
