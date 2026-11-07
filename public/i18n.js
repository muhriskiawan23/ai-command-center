/* BOR AI multilingual UI. User-selected locale is shared with the chat API. */
(() => {
  "use strict";
  const STORAGE_KEY = "borai-language-preference";
  const locales = {
    en: { label:"English", dir:"ltr", messages:{
      "Memuat BOR AI…":"Loading BOR AI…","Navigasi":"Navigation","Cari percakapan":"Search conversations","Chat baru":"New chat","Percakapan":"Conversations","Lihat arsip":"View archive","Penggunaan":"Usage","Penggunaan hari ini":"Today's usage","Integrasi":"Integrations","Memori":"Memory","Tentang BOR AI":"About BOR AI","Hapus semua riwayat":"Delete all history","Berpikir lebih jernih. Bekerja lebih terarah.":"Think smarter. Do more.","Ruang kerja AI terpadu untuk riset, analisis, penulisan, dan pengembangan.":"One AI workspace for research, analysis, writing, and building.","Perencanaan strategis":"Strategic planning","Susun prioritas dan langkah eksekusi":"Set priorities and define execution steps","Analisis mendalam":"In-depth analysis","Evaluasi opsi, risiko, dan trade-off":"Evaluate options, risks, and trade-offs","Pengembangan ide":"Idea development","Ubah gagasan menjadi konsep konkret":"Turn ideas into concrete concepts","Engineering & coding":"Engineering & coding","Review, debugging, dan solusi teknis":"Reviews, debugging, and technical solutions","Kirim pesan ke BOR AI…":"Message BOR AI…","Kirim pesan":"Send message","Hentikan generasi":"Stop generating","Enter = baris baru · tekan ↑ untuk kirim":"Enter = new line · press ↑ to send","Layanan aktif":"Service online","Terhubung ke BOR AI":"Connected to BOR AI","Layanan tidak aktif":"Service unavailable","Status tidak siap":"Service not ready","Email":"Email","Buat draft email":"Create email draft","Siapkan draft di chat":"Prepare draft in chat","Generator Draft Email":"Email draft generator","Penerima (opsional)":"Recipient (optional)","Subjek (opsional)":"Subject (optional)","Tujuan / konteks *":"Purpose / context *","Poin penting (opsional)":"Key points (optional)","Profesional":"Professional","Formal":"Formal","Ramah":"Friendly","Persuasif":"Persuasive","Singkat dan langsung":"Brief and direct","Bahasa":"Language","Lihat proses multi-agent":"View multi-agent process","Salin":"Copy","Teks":"Text","Buat ulang":"Regenerate","Edit & kirim":"Edit & send","Apakah jawaban ini membantu?":"Was this answer helpful?","Kirim feedback":"Send feedback","Hubungkan akun GitHub":"Connect GitHub account","Putuskan koneksi":"Disconnect","Tutup integrasi":"Close integrations","Cari repository":"Search repositories","Semua":"All","Memuat repository…":"Loading repositories…","Pilih repository untuk melihat detailnya.":"Select a repository to view its details.","Belum ada yang tersimpan.":"Nothing saved yet.","Hapus semua memori":"Delete all memories","Tersimpan":"Saved","Akun Google":"Google account","Lanjutkan dengan Google":"Continue with Google","Lanjutkan sebagai Guest":"Continue as Guest","AI dapat membuat kesalahan. Periksa kembali informasi penting sebelum mengambil keputusan.":"AI can make mistakes. Verify important information before making decisions."
    }},
    id:{label:"Bahasa Indonesia",dir:"ltr",messages:{}},
    es:{label:"Español",dir:"ltr",messages:{
      "Navigation":"Navegación","Search conversations":"Buscar conversaciones","New chat":"Nuevo chat","Conversations":"Conversaciones","View archive":"Ver archivo","Usage":"Uso","Integrations":"Integraciones","Memory":"Memoria","About BOR AI":"Acerca de BOR AI","Delete all history":"Eliminar todo el historial","Think smarter. Do more.":"Piensa mejor. Haz más.","One AI workspace for research, analysis, writing, and building.":"Un espacio de IA para investigar, analizar, escribir y crear.","Strategic planning":"Planificación estratégica","In-depth analysis":"Análisis profundo","Idea development":"Desarrollo de ideas","Engineering & coding":"Ingeniería y programación","Message BOR AI…":"Mensaje para BOR AI…","Send message":"Enviar mensaje","Stop generating":"Detener generación","Service online":"Servicio activo","Connected to BOR AI":"Conectado a BOR AI","Was this answer helpful?":"¿Te resultó útil esta respuesta?","Copy":"Copiar","Regenerate":"Regenerar","Language":"Idioma"
    }},
    fr:{label:"Français",dir:"ltr",messages:{
      "Navigation":"Navigation","Search conversations":"Rechercher des conversations","New chat":"Nouvelle discussion","Conversations":"Conversations","View archive":"Voir les archives","Usage":"Utilisation","Integrations":"Intégrations","Memory":"Mémoire","About BOR AI":"À propos de BOR AI","Delete all history":"Supprimer tout l’historique","Think smarter. Do more.":"Réfléchissez mieux. Faites plus.","One AI workspace for research, analysis, writing, and building.":"Un espace IA pour rechercher, analyser, écrire et créer.","Strategic planning":"Planification stratégique","In-depth analysis":"Analyse approfondie","Idea development":"Développement d’idées","Engineering & coding":"Ingénierie et programmation","Message BOR AI…":"Message pour BOR AI…","Send message":"Envoyer","Stop generating":"Arrêter la génération","Service online":"Service actif","Connected to BOR AI":"Connecté à BOR AI","Was this answer helpful?":"Cette réponse vous a-t-elle aidé ?","Copy":"Copier","Regenerate":"Régénérer","Language":"Langue"
    }},
    de:{label:"Deutsch",dir:"ltr",messages:{
      "Navigation":"Navigation","Search conversations":"Unterhaltungen suchen","New chat":"Neuer Chat","Conversations":"Unterhaltungen","View archive":"Archiv ansehen","Usage":"Nutzung","Integrations":"Integrationen","Memory":"Erinnerungen","About BOR AI":"Über BOR AI","Delete all history":"Gesamten Verlauf löschen","Think smarter. Do more.":"Denke klüger. Erreiche mehr.","One AI workspace for research, analysis, writing, and building.":"Ein KI-Arbeitsbereich für Recherche, Analyse, Schreiben und Entwicklung.","Strategic planning":"Strategische Planung","In-depth analysis":"Tiefgehende Analyse","Idea development":"Ideenentwicklung","Engineering & coding":"Technik & Programmierung","Message BOR AI…":"Nachricht an BOR AI…","Send message":"Nachricht senden","Stop generating":"Generierung stoppen","Service online":"Dienst aktiv","Connected to BOR AI":"Mit BOR AI verbunden","Was this answer helpful?":"War diese Antwort hilfreich?","Copy":"Kopieren","Regenerate":"Erneut generieren","Language":"Sprache"
    }},
    pt:{label:"Português (Brasil)",dir:"ltr",messages:{
      "Navigation":"Navegação","Search conversations":"Pesquisar conversas","New chat":"Novo chat","Conversations":"Conversas","View archive":"Ver arquivo","Usage":"Uso","Integrations":"Integrações","Memory":"Memória","About BOR AI":"Sobre o BOR AI","Delete all history":"Excluir todo o histórico","Think smarter. Do more.":"Pense melhor. Faça mais.","One AI workspace for research, analysis, writing, and building.":"Um espaço de IA para pesquisar, analisar, escrever e desenvolver.","Strategic planning":"Planejamento estratégico","In-depth analysis":"Análise aprofundada","Idea development":"Desenvolvimento de ideias","Engineering & coding":"Engenharia e programação","Message BOR AI…":"Mensagem para o BOR AI…","Send message":"Enviar mensagem","Stop generating":"Parar geração","Service online":"Serviço ativo","Connected to BOR AI":"Conectado ao BOR AI","Was this answer helpful?":"Esta resposta foi útil?","Copy":"Copiar","Regenerate":"Gerar novamente","Language":"Idioma"
    }},
    ja:{label:"日本語",dir:"ltr",messages:{
      "Navigation":"ナビゲーション","Search conversations":"会話を検索","New chat":"新しいチャット","Conversations":"会話","View archive":"アーカイブを見る","Usage":"使用状況","Integrations":"連携","Memory":"メモリ","About BOR AI":"BOR AIについて","Delete all history":"履歴をすべて削除","Think smarter. Do more.":"より賢く考え、もっと実現する。","One AI workspace for research, analysis, writing, and building.":"調査、分析、執筆、開発のためのAIワークスペース。","Strategic planning":"戦略立案","In-depth analysis":"詳細分析","Idea development":"アイデア開発","Engineering & coding":"エンジニアリング・コーディング","Message BOR AI…":"BOR AIにメッセージ…","Send message":"送信","Stop generating":"生成を停止","Service online":"サービス稼働中","Connected to BOR AI":"BOR AIに接続済み","Was this answer helpful?":"この回答は役に立ちましたか？","Copy":"コピー","Regenerate":"再生成","Language":"言語"
    }},
    ko:{label:"한국어",dir:"ltr",messages:{
      "Navigation":"탐색","Search conversations":"대화 검색","New chat":"새 채팅","Conversations":"대화","View archive":"보관함 보기","Usage":"사용량","Integrations":"연동","Memory":"메모리","About BOR AI":"BOR AI 소개","Delete all history":"전체 기록 삭제","Think smarter. Do more.":"더 깊이 생각하고, 더 많이 실현하세요.","One AI workspace for research, analysis, writing, and building.":"조사, 분석, 글쓰기, 개발을 위한 통합 AI 작업 공간.","Strategic planning":"전략 기획","In-depth analysis":"심층 분석","Idea development":"아이디어 개발","Engineering & coding":"엔지니어링 및 코딩","Message BOR AI…":"BOR AI에 메시지…","Send message":"메시지 보내기","Stop generating":"생성 중지","Service online":"서비스 정상 작동","Connected to BOR AI":"BOR AI에 연결됨","Was this answer helpful?":"이 답변이 도움이 되었나요?","Copy":"복사","Regenerate":"다시 생성","Language":"언어"
    }},
    zh:{label:"简体中文",dir:"ltr",messages:{
      "Navigation":"导航","Search conversations":"搜索对话","New chat":"新建聊天","Conversations":"对话","View archive":"查看归档","Usage":"用量","Integrations":"集成","Memory":"记忆","About BOR AI":"关于 BOR AI","Delete all history":"删除所有历史记录","Think smarter. Do more.":"思考更聪明，成就更多。","One AI workspace for research, analysis, writing, and building.":"集研究、分析、写作与开发于一体的 AI 工作空间。","Strategic planning":"战略规划","In-depth analysis":"深度分析","Idea development":"创意开发","Engineering & coding":"工程与编程","Message BOR AI…":"给 BOR AI 发送消息…","Send message":"发送消息","Stop generating":"停止生成","Service online":"服务正常","Connected to BOR AI":"已连接 BOR AI","Was this answer helpful?":"这个回答有帮助吗？","Copy":"复制","Regenerate":"重新生成","Language":"语言"
    }},
    ar:{label:"العربية",dir:"rtl",messages:{
      "Navigation":"التنقل","Search conversations":"البحث في المحادثات","New chat":"محادثة جديدة","Conversations":"المحادثات","View archive":"عرض الأرشيف","Usage":"الاستخدام","Integrations":"التكاملات","Memory":"الذاكرة","About BOR AI":"حول BOR AI","Delete all history":"حذف كل السجل","Think smarter. Do more.":"فكّر بذكاء أكبر. أنجز المزيد.","One AI workspace for research, analysis, writing, and building.":"مساحة عمل واحدة للبحث والتحليل والكتابة والتطوير.","Strategic planning":"التخطيط الاستراتيجي","In-depth analysis":"تحليل متعمق","Idea development":"تطوير الأفكار","Engineering & coding":"الهندسة والبرمجة","Message BOR AI…":"اكتب رسالة إلى BOR AI…","Send message":"إرسال الرسالة","Stop generating":"إيقاف الإنشاء","Service online":"الخدمة تعمل","Connected to BOR AI":"متصل بـ BOR AI","Was this answer helpful?":"هل كانت هذه الإجابة مفيدة؟","Copy":"نسخ","Regenerate":"إعادة الإنشاء","Language":"اللغة"
    }}
  };
  const idToEnglish = Object.fromEntries(Object.entries(locales.en.messages).map(([id,en])=>[id,en]));
  const aliases = {
    "Ruang kerja AI terpadu untuk riset, analisis, penulisan, dan pengembangan.":"One AI workspace for research, analysis, writing, and building.",
    "Susun prioritas dan langkah eksekusi":"Set priorities and define execution steps",
    "Evaluasi opsi, risiko, dan trade-off":"Evaluate options, risks, and trade-offs",
    "Ubah gagasan menjadi konsep konkret":"Turn ideas into concrete concepts",
    "Review, debugging, dan solusi teknis":"Reviews, debugging, and technical solutions"
  };
  const supported = Object.keys(locales);
  const preference = () => { try { return localStorage.getItem(STORAGE_KEY) || "auto"; } catch { return "auto"; } };
  const detect = () => {
    const candidates = navigator.languages?.length ? navigator.languages : [navigator.language || "en"];
    for (const candidate of candidates) {
      const raw=String(candidate).toLowerCase();
      const code=raw.split("-")[0];
      if (code==="zh") return "zh";
      if (code==="pt") return "pt";
      if (supported.includes(code)) return code;
    }
    return "en";
  };
  let active="en";
  const translate = (value) => {
    const key=aliases[value] || value;
    const canonical=idToEnglish[key] || key;
    return locales[active]?.messages[canonical] || (active==="id" ? value : canonical);
  };
  const shouldSkip = (node) => {
    const parent=node.parentElement;
    return !parent || parent.closest("script,style,code,pre,.message-text,[data-no-translate]");
  };
  const translateTree = (root=document.body) => {
    if (!root) return;
    const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
    let node;
    while((node=walker.nextNode())) {
      if(shouldSkip(node)) continue;
      const raw=node.nodeValue;
      const trimmed=raw.trim();
      if(!trimmed) continue;
      const translated=translate(trimmed);
      if(translated!==trimmed) node.nodeValue=raw.replace(trimmed,translated);
    }
    root.querySelectorAll?.("input[placeholder],textarea[placeholder],button[title],[aria-label]").forEach(el=>{
      for(const attr of ["placeholder","title","aria-label"]) {
        const value=el.getAttribute(attr);
        if(value) { const t=translate(value); if(t!==value) el.setAttribute(attr,t); }
      }
    });
  };
  const apply = (choice=preference()) => {
    active=choice==="auto" ? detect() : (supported.includes(choice)?choice:"en");
    const locale=locales[active];
    document.documentElement.lang=active;
    document.documentElement.dir=locale.dir;
    document.documentElement.dataset.language=active;
    document.documentElement.dataset.direction=locale.dir;
    translateTree();
    const heading=document.querySelector("#welcome h1");
    if(heading) heading.textContent=translate("Berpikir lebih jernih. Bekerja lebih terarah.");
    const picker=document.querySelector("#languagePreference");
    if(picker) picker.value=choice;
    const prompt=document.querySelector("#prompt");
    if(prompt) prompt.placeholder=translate("Kirim pesan ke BOR AI…");
  };
  const init = () => {
    const topbar=document.querySelector(".topbar-actions");
    if(topbar&&!document.querySelector("#languagePreference")) {
      const wrap=document.createElement("label");wrap.className="language-picker";wrap.setAttribute("aria-label","Display language");
      const select=document.createElement("select");select.id="languagePreference";select.title="Display language";
      select.innerHTML='<option value="auto">🌐 Automatic</option><option value="en">English</option><option value="id">Bahasa Indonesia</option><option value="es">Español</option><option value="fr">Français</option><option value="de">Deutsch</option><option value="pt">Português (Brasil)</option><option value="ja">日本語</option><option value="ko">한국어</option><option value="zh">简体中文</option><option value="ar">العربية</option>';
      select.addEventListener("change",()=>{try{localStorage.setItem(STORAGE_KEY,select.value)}catch{};apply(select.value);location.reload()});
      wrap.append(select);topbar.prepend(wrap);
    }
    apply();
    const observer=new MutationObserver(records=>{for(const record of records){if(record.type==="childList"){record.addedNodes.forEach(n=>{if(n.nodeType===Node.TEXT_NODE){if(!shouldSkip(n)){const t=n.nodeValue.trim(),v=translate(t);if(t&&t!==v)n.nodeValue=n.nodeValue.replace(t,v)}}else if(n.nodeType===Node.ELEMENT_NODE)translateTree(n)})}else if(record.type==="characterData"&&!shouldSkip(record.target)){const t=record.target.nodeValue.trim(),v=translate(t);if(t&&t!==v)record.target.nodeValue=record.target.nodeValue.replace(t,v)}}});
    observer.observe(document.body,{subtree:true,childList:true,characterData:true});
  };
  window.BORLocale={get current(){return active},get preference(){return preference()},get direction(){return locales[active]?.dir||"ltr"},apply,translate};
  if(document.readyState==="loading") document.addEventListener("DOMContentLoaded",init,{once:true}); else init();
})();
