/* BOR AI multilingual UI. User-selected locale is shared with the chat API. */
(() => {
  "use strict";
  const STORAGE_KEY = "borai-language-preference";
  const locales = {
    en: { label:"English", dir:"ltr", messages:{
      "Memuat BOR AI…":"Loading BOR AI…","Navigasi":"Navigation","Cari percakapan":"Search conversations","Chat baru":"New chat","Percakapan":"Conversations","Lihat arsip":"View archive","Penggunaan":"Usage","Penggunaan hari ini":"Today's usage","Integrasi":"Integrations","Memori":"Memory","Tentang BOR AI":"About BOR AI","Hapus semua riwayat":"Delete all history","Berpikir lebih jernih. Bekerja lebih terarah.":"Think smarter. Do more.","Ruang kerja AI terpadu untuk riset, analisis, penulisan, dan pengembangan.":"One AI workspace for research, analysis, writing, and building.","Perencanaan strategis":"Strategic planning","Susun prioritas dan langkah eksekusi":"Set priorities and define execution steps","Analisis mendalam":"In-depth analysis","Evaluasi opsi, risiko, dan trade-off":"Evaluate options, risks, and trade-offs","Pengembangan ide":"Idea development","Ubah gagasan menjadi konsep konkret":"Turn ideas into concrete concepts","Engineering & coding":"Engineering & coding","Review, debugging, dan solusi teknis":"Reviews, debugging, and technical solutions","Kirim pesan ke BOR AI…":"Message BOR AI…","Kirim pesan":"Send message","Hentikan generasi":"Stop generating","Enter = baris baru · tekan ↑ untuk kirim":"Enter = new line · press ↑ to send","Layanan aktif":"Service online","Terhubung ke BOR AI":"Connected to BOR AI","Layanan tidak aktif":"Service unavailable","Status tidak siap":"Service not ready","Email":"Email","Buat draft email":"Create email draft","Siapkan draft di chat":"Prepare draft in chat","Generator Draft Email":"Email draft generator","Penerima (opsional)":"Recipient (optional)","Subjek (opsional)":"Subject (optional)","Tujuan / konteks *":"Purpose / context *","Poin penting (opsional)":"Key points (optional)","Profesional":"Professional","Formal":"Formal","Ramah":"Friendly","Persuasif":"Persuasive","Singkat dan langsung":"Brief and direct","Bahasa":"Language","Lihat proses multi-agent":"View multi-agent process","Salin":"Copy","Teks":"Text","Buat ulang":"Regenerate","Edit & kirim":"Edit & send","Apakah jawaban ini membantu?":"Was this answer helpful?","Kirim feedback":"Send feedback","Hubungkan akun GitHub":"Connect GitHub account","Putuskan koneksi":"Disconnect","Tutup integrasi":"Close integrations","Cari repository":"Search repositories","Semua":"All","Memuat repository…":"Loading repositories…","Pilih repository untuk melihat detailnya.":"Select a repository to view its details.","Belum ada yang tersimpan.":"Nothing saved yet.","Hapus semua memori":"Delete all memories","Tersimpan":"Saved","Akun Google":"Google account","Lanjutkan dengan Google":"Continue with Google","Lanjutkan sebagai Guest":"Continue as Guest","AI dapat membuat kesalahan. Periksa kembali informasi penting sebelum mengambil keputusan.":"AI can make mistakes. Verify important information before making decisions.",
      "BOR AI membutuhkan JavaScript untuk berjalan.":"BOR AI requires JavaScript to run.",
      "Riset, analisis, ide, coding, dan perencanaan bersama asisten AI multi-agent.":"Research, analysis, ideas, coding, and planning with a multi-agent AI assistant.",
      "Coba muat Google Sign-In lagi":"Try Google Sign-In again",
      "Periksa status akun lagi":"Check account status again",
      "riwayat chat tersimpan di server dan hanya ditampilkan untuk akun Anda. Bisa dihapus kapan saja.":"chat history is stored on the server and only shown to your account. You can delete it anytime.",
      "tanpa akun. Chat tidak disimpan dan hilang saat halaman dimuat ulang.":"no account required. Chats are not saved and disappear when the page reloads.",
      "Pesan Anda diproses oleh layanan AI. Jangan mengirim data sensitif atau rahasia.":"Your messages are processed by AI services. Do not send sensitive or confidential data.",
      "Belum dimuat":"Not loaded yet",
      "1 unit untuk pesan biasa; 3 unit untuk permintaan multi-agent. Ini bukan estimasi biaya tagihan.":"1 unit per regular message; 3 units per multi-agent request. This is not a billing estimate.",
      "Guest Mode":"Guest Mode",
      "Keluar":"Sign out",
      "Memeriksa layanan…":"Checking service…",
      "YOUR AI WORKSPACE":"YOUR AI WORKSPACE",
      "Generator Draft Email":"Email draft generator",
      "Periksa dan kirim sendiri; email tidak dikirim otomatis.":"Review and send it yourself; emails are not sent automatically.",
      "Tujuan / konteks *":"Purpose / context *",
      "Informasi yang harus disampaikan":"Information to include",
      "Pilih mode AI":"Choose AI mode",
      "Multi-agent (disarankan)":"Multi-agent (recommended)",
      "Researcher · Riset":"Researcher · Research",
      "Analyst · Analisis":"Analyst · Analysis",
      "Writer · Penulisan":"Writer · Writing",
      "Fact Checker · Audit":"Fact Checker · Audit",
      "Strategist · Strategi":"Strategist · Strategy",
      "Coder · Coding":"Coder · Coding",
      "Planner · Perencanaan":"Planner · Planning",
      "Critic · Kritik":"Critic · Critique",
      "Summarizer · Ringkasan":"Summarizer · Summary",
      "Translator · Terjemahan":"Translator · Translation",
      "Text Analyst · Analisis Teks":"Text Analyst · Text analysis",
      "Kelola koneksi layanan eksternal BOR AI.":"Manage BOR AI external service connections.",
      "Repository, perubahan kode, commit, dan deployment":"Repositories, code changes, commits, and deployments",
      "Hubungkan GitHub untuk membaca repository dan mengelola perubahan dengan izinmu.":"Connect GitHub to read repositories and manage changes with your permission.",
      "Periksa koneksi akun":"Check account connection",
      "Repository yang dapat diakses melalui instalasi BOR AI.":"Repositories accessible through the BOR AI installation.",
      "Filter visibilitas":"Visibility filter",
      "Public":"Public",
      "Private":"Private",
      "Intelligence Without Limit":"Intelligence Without Limit",
      "Apa itu BOR AI?":"What is BOR AI?",
      "Yang bisa kamu lakukan":"What you can do",
      "Pilih mode riset, analisis, penulisan, coding, strategi, perencanaan, dan lainnya.":"Choose research, analysis, writing, coding, strategy, planning, and other modes.",
      "Kelola percakapan dengan pencarian, pin, arsip, rename, ekspor, dan kontrol generasi.":"Manage conversations with search, pinning, archive, rename, export, and generation controls.",
      "Untuk akun yang masuk, memori bersifat opsional dan hanya menyimpan hal yang kamu pilih.":"For signed-in accounts, memory is optional and only stores what you choose.",
      "Privasi dan kendali":"Privacy and control",
      "Percakapan Guest Mode hanya berada di memori halaman dan tidak menjadi riwayat akun.":"Guest Mode conversations exist only in page memory and do not become account history.",
      "Riwayat akun yang masuk bersifat privat dan dibatasi ke akun pemiliknya.":"Signed-in account history is private and restricted to its owner.",
      "Memori opsional nonaktif secara default dan memerlukan tindakan eksplisit.":"Optional memory is off by default and requires explicit action.",
      "Panel penggunaan menampilkan kuota akun atau sesi saat ini, bukan estimasi tagihan.":"The usage panel shows the current account or session quota, not a billing estimate.",
      "Gunakan penilaianmu sendiri.":"Use your own judgment.",
      "Repository resmi ↗":"Official repository ↗",
      "Simpan":"Save",
      "Aktifkan memori":"Enable memory",
      "Jangan simpan data sensitif":"Do not store sensitive data",
      "kamu sendiri":"you choose"

    }},
    id:{label:"Bahasa Indonesia",dir:"ltr",messages:{}},
    es:{label:"Español",dir:"ltr",messages:{
      "Navigation":"Navegación","Search conversations":"Buscar conversaciones","New chat":"Nuevo chat","Conversations":"Conversaciones","View archive":"Ver archivo","Usage":"Uso","Integrations":"Integraciones","Memory":"Memoria","About BOR AI":"Acerca de BOR AI","Delete all history":"Eliminar todo el historial","Think smarter. Do more.":"Piensa mejor. Haz más.","One AI workspace for research, analysis, writing, and building.":"Un espacio de IA para investigar, analizar, escribir y crear.","Strategic planning":"Planificación estratégica","In-depth analysis":"Análisis profundo","Idea development":"Desarrollo de ideas","Engineering & coding":"Ingeniería y programación","Message BOR AI…":"Mensaje para BOR AI…","Send message":"Enviar mensaje","Stop generating":"Detener generación","Service online":"Servicio activo","Connected to BOR AI":"Conectado a BOR AI","Was this answer helpful?":"¿Te resultó útil esta respuesta?","Copy":"Copiar","Regenerate":"Regenerar","Language":"Idioma","Usage today":"Uso de hoy","Service unavailable":"Servicio no disponible","Service not ready":"Servicio no preparado","Email":"Correo electrónico","Create email draft":"Crear borrador de correo","Send feedback":"Enviar comentarios","Connect GitHub account":"Conectar cuenta de GitHub","Disconnect":"Desconectar","Search repositories":"Buscar repositorios","Loading repositories…":"Cargando repositorios…","Continue with Google":"Continuar con Google","Continue as Guest":"Continuar como invitado"
    }},
    fr:{label:"Français",dir:"ltr",messages:{
      "Navigation":"Navigation","Search conversations":"Rechercher des conversations","New chat":"Nouvelle discussion","Conversations":"Conversations","View archive":"Voir les archives","Usage":"Utilisation","Integrations":"Intégrations","Memory":"Mémoire","About BOR AI":"À propos de BOR AI","Delete all history":"Supprimer tout l’historique","Think smarter. Do more.":"Réfléchissez mieux. Faites plus.","One AI workspace for research, analysis, writing, and building.":"Un espace IA pour rechercher, analyser, écrire et créer.","Strategic planning":"Planification stratégique","In-depth analysis":"Analyse approfondie","Idea development":"Développement d’idées","Engineering & coding":"Ingénierie et programmation","Message BOR AI…":"Message pour BOR AI…","Send message":"Envoyer","Stop generating":"Arrêter la génération","Service online":"Service actif","Connected to BOR AI":"Connecté à BOR AI","Was this answer helpful?":"Cette réponse vous a-t-elle aidé ?","Copy":"Copier","Regenerate":"Régénérer","Language":"Langue","Usage today":"Utilisation aujourd’hui","Service unavailable":"Service indisponible","Service not ready":"Service non prêt","Email":"E-mail","Create email draft":"Créer un brouillon d’e-mail","Send feedback":"Envoyer un avis","Connect GitHub account":"Connecter le compte GitHub","Disconnect":"Déconnecter","Search repositories":"Rechercher des dépôts","Loading repositories…":"Chargement des dépôts…","Continue with Google":"Continuer avec Google","Continue as Guest":"Continuer en tant qu’invité"
    }},
    de:{label:"Deutsch",dir:"ltr",messages:{
      "Navigation":"Navigation","Search conversations":"Unterhaltungen suchen","New chat":"Neuer Chat","Conversations":"Unterhaltungen","View archive":"Archiv ansehen","Usage":"Nutzung","Integrations":"Integrationen","Memory":"Erinnerungen","About BOR AI":"Über BOR AI","Delete all history":"Gesamten Verlauf löschen","Think smarter. Do more.":"Denke klüger. Erreiche mehr.","One AI workspace for research, analysis, writing, and building.":"Ein KI-Arbeitsbereich für Recherche, Analyse, Schreiben und Entwicklung.","Strategic planning":"Strategische Planung","In-depth analysis":"Tiefgehende Analyse","Idea development":"Ideenentwicklung","Engineering & coding":"Technik & Programmierung","Message BOR AI…":"Nachricht an BOR AI…","Send message":"Nachricht senden","Stop generating":"Generierung stoppen","Service online":"Dienst aktiv","Connected to BOR AI":"Mit BOR AI verbunden","Was this answer helpful?":"War diese Antwort hilfreich?","Copy":"Kopieren","Regenerate":"Erneut generieren","Language":"Sprache","Usage today":"Heutige Nutzung","Service unavailable":"Dienst nicht verfügbar","Service not ready":"Dienst nicht bereit","Email":"E-Mail","Create email draft":"E-Mail-Entwurf erstellen","Send feedback":"Feedback senden","Connect GitHub account":"GitHub-Konto verbinden","Disconnect":"Trennen","Search repositories":"Repositories suchen","Loading repositories…":"Repositories werden geladen…","Continue with Google":"Mit Google fortfahren","Continue as Guest":"Als Gast fortfahren"
    }},
    pt:{label:"Português (Brasil)",dir:"ltr",messages:{
      "Navigation":"Navegação","Search conversations":"Pesquisar conversas","New chat":"Novo chat","Conversations":"Conversas","View archive":"Ver arquivo","Usage":"Uso","Integrations":"Integrações","Memory":"Memória","About BOR AI":"Sobre o BOR AI","Delete all history":"Excluir todo o histórico","Think smarter. Do more.":"Pense melhor. Faça mais.","One AI workspace for research, analysis, writing, and building.":"Um espaço de IA para pesquisar, analisar, escrever e desenvolver.","Strategic planning":"Planejamento estratégico","In-depth analysis":"Análise aprofundada","Idea development":"Desenvolvimento de ideias","Engineering & coding":"Engenharia e programação","Message BOR AI…":"Mensagem para o BOR AI…","Send message":"Enviar mensagem","Stop generating":"Parar geração","Service online":"Serviço ativo","Connected to BOR AI":"Conectado ao BOR AI","Was this answer helpful?":"Esta resposta foi útil?","Copy":"Copiar","Regenerate":"Gerar novamente","Language":"Idioma","Usage today":"Uso de hoje","Service unavailable":"Serviço indisponível","Service not ready":"Serviço não está pronto","Email":"E-mail","Create email draft":"Criar rascunho de e-mail","Send feedback":"Enviar feedback","Connect GitHub account":"Conectar conta do GitHub","Disconnect":"Desconectar","Search repositories":"Pesquisar repositórios","Loading repositories…":"Carregando repositórios…","Continue with Google":"Continuar com o Google","Continue as Guest":"Continuar como visitante"
    }},
    ja:{label:"日本語",dir:"ltr",messages:{
      "Navigation":"ナビゲーション","Search conversations":"会話を検索","New chat":"新しいチャット","Conversations":"会話","View archive":"アーカイブを見る","Usage":"使用状況","Integrations":"連携","Memory":"メモリ","About BOR AI":"BOR AIについて","Delete all history":"履歴をすべて削除","Think smarter. Do more.":"より賢く考え、もっと実現する。","One AI workspace for research, analysis, writing, and building.":"調査、分析、執筆、開発のためのAIワークスペース。","Strategic planning":"戦略立案","In-depth analysis":"詳細分析","Idea development":"アイデア開発","Engineering & coding":"エンジニアリング・コーディング","Message BOR AI…":"BOR AIにメッセージ…","Send message":"送信","Stop generating":"生成を停止","Service online":"サービス稼働中","Connected to BOR AI":"BOR AIに接続済み","Was this answer helpful?":"この回答は役に立ちましたか？","Copy":"コピー","Regenerate":"再生成","Language":"言語","Usage today":"本日の使用量","Service unavailable":"サービスを利用できません","Service not ready":"サービスの準備ができていません","Email":"メール","Create email draft":"メールの下書きを作成","Send feedback":"フィードバックを送信","Connect GitHub account":"GitHubアカウントを接続","Disconnect":"接続を解除","Search repositories":"リポジトリを検索","Loading repositories…":"リポジトリを読み込み中…","Continue with Google":"Googleで続行","Continue as Guest":"ゲストとして続行"
    }},
    ko:{label:"한국어",dir:"ltr",messages:{
      "Navigation":"탐색","Search conversations":"대화 검색","New chat":"새 채팅","Conversations":"대화","View archive":"보관함 보기","Usage":"사용량","Integrations":"연동","Memory":"메모리","About BOR AI":"BOR AI 소개","Delete all history":"전체 기록 삭제","Think smarter. Do more.":"더 깊이 생각하고, 더 많이 실현하세요.","One AI workspace for research, analysis, writing, and building.":"조사, 분석, 글쓰기, 개발을 위한 통합 AI 작업 공간.","Strategic planning":"전략 기획","In-depth analysis":"심층 분석","Idea development":"아이디어 개발","Engineering & coding":"엔지니어링 및 코딩","Message BOR AI…":"BOR AI에 메시지…","Send message":"메시지 보내기","Stop generating":"생성 중지","Service online":"서비스 정상 작동","Connected to BOR AI":"BOR AI에 연결됨","Was this answer helpful?":"이 답변이 도움이 되었나요?","Copy":"복사","Regenerate":"다시 생성","Language":"언어","Usage today":"오늘 사용량","Service unavailable":"서비스를 사용할 수 없습니다","Service not ready":"서비스 준비가 완료되지 않았습니다","Email":"이메일","Create email draft":"이메일 초안 작성","Send feedback":"피드백 보내기","Connect GitHub account":"GitHub 계정 연결","Disconnect":"연결 해제","Search repositories":"저장소 검색","Loading repositories…":"저장소 불러오는 중…","Continue with Google":"Google로 계속하기","Continue as Guest":"게스트로 계속하기"
    }},
    zh:{label:"简体中文",dir:"ltr",messages:{
      "Navigation":"导航","Search conversations":"搜索对话","New chat":"新建聊天","Conversations":"对话","View archive":"查看归档","Usage":"用量","Integrations":"集成","Memory":"记忆","About BOR AI":"关于 BOR AI","Delete all history":"删除所有历史记录","Think smarter. Do more.":"思考更聪明，成就更多。","One AI workspace for research, analysis, writing, and building.":"集研究、分析、写作与开发于一体的 AI 工作空间。","Strategic planning":"战略规划","In-depth analysis":"深度分析","Idea development":"创意开发","Engineering & coding":"工程与编程","Message BOR AI…":"给 BOR AI 发送消息…","Send message":"发送消息","Stop generating":"停止生成","Service online":"服务正常","Connected to BOR AI":"已连接 BOR AI","Was this answer helpful?":"这个回答有帮助吗？","Copy":"复制","Regenerate":"重新生成","Language":"语言","Usage today":"今日用量","Service unavailable":"服务不可用","Service not ready":"服务尚未就绪","Email":"电子邮件","Create email draft":"创建邮件草稿","Send feedback":"发送反馈","Connect GitHub account":"连接 GitHub 账户","Disconnect":"断开连接","Search repositories":"搜索代码仓库","Loading repositories…":"正在加载代码仓库…","Continue with Google":"使用 Google 继续","Continue as Guest":"以访客身份继续"
    }},
    ar:{label:"العربية",dir:"rtl",messages:{
      "Navigation":"التنقل","Search conversations":"البحث في المحادثات","New chat":"محادثة جديدة","Conversations":"المحادثات","View archive":"عرض الأرشيف","Usage":"الاستخدام","Integrations":"التكاملات","Memory":"الذاكرة","About BOR AI":"حول BOR AI","Delete all history":"حذف كل السجل","Think smarter. Do more.":"فكّر بذكاء أكبر. أنجز المزيد.","One AI workspace for research, analysis, writing, and building.":"مساحة عمل واحدة للبحث والتحليل والكتابة والتطوير.","Strategic planning":"التخطيط الاستراتيجي","In-depth analysis":"تحليل متعمق","Idea development":"تطوير الأفكار","Engineering & coding":"الهندسة والبرمجة","Message BOR AI…":"اكتب رسالة إلى BOR AI…","Send message":"إرسال الرسالة","Stop generating":"إيقاف الإنشاء","Service online":"الخدمة تعمل","Connected to BOR AI":"متصل بـ BOR AI","Was this answer helpful?":"هل كانت هذه الإجابة مفيدة؟","Copy":"نسخ","Regenerate":"إعادة الإنشاء","Language":"اللغة","Usage today":"الاستخدام اليوم","Service unavailable":"الخدمة غير متاحة","Service not ready":"الخدمة غير جاهزة","Email":"البريد الإلكتروني","Create email draft":"إنشاء مسودة بريد إلكتروني","Send feedback":"إرسال الملاحظات","Connect GitHub account":"ربط حساب GitHub","Disconnect":"قطع الاتصال","Search repositories":"البحث في المستودعات","Loading repositories…":"جارٍ تحميل المستودعات…","Continue with Google":"المتابعة باستخدام Google","Continue as Guest":"المتابعة كضيف"
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
  // Dynamic workspace strings are keyed by their Indonesian source text so
  // runtime-created buttons, status labels, toasts, and empty states use the same locale layer.
  const extraTranslations = {
    en: {
      "Ekspor chat":"Export chat","Cetak PDF":"Print PDF","Nada":"Tone","Bahasa Indonesia":"Indonesian","Bahasa Indonesia dan English":"Indonesian and English",
      "Siapkan draft di chat":"Prepare draft in chat","Edit & kirim":"Edit & send","Buat ulang":"Regenerate","Teks":"Text","PDF / Cetak":"PDF / Print",
      "Kirim feedback":"Send feedback","Feedback tersimpan":"Feedback saved","Perbarui feedback":"Update feedback","Jawaban tidak membantu":"This answer was not helpful","Tidak membantu":"Not helpful",
      "Layanan aktif":"Service online","Terhubung ke BOR AI":"Connected to BOR AI","Layanan tidak aktif":"Service unavailable","Status tidak siap":"Service not ready",
      "Memeriksa koneksi…":"Checking connection…","Belum terhubung":"Not connected","Hubungkan akun GitHub":"Connect GitHub account","Putuskan koneksi":"Disconnect",
      "Akun GitHub siap digunakan. Akses repository tetap mengikuti izin GitHub App yang kamu berikan.":"GitHub account is ready. Repository access follows the permissions you granted to the GitHub App.",
      "Hubungkan akun GitHub untuk membaca repository dan mengelola perubahan setelah mendapat izinmu.":"Connect GitHub to read repositories and manage changes after you grant permission.",
      "Tidak ada repository yang cocok dengan pencarian.":"No repositories match your search.","Belum ada repository yang tersedia.":"No repositories are available yet.",
      "Pilih repository untuk melihat detailnya.":"Select a repository to view its details.","Tidak ada deskripsi.":"No description.",
      "Memuat daftar repository…":"Loading repositories…","Coba muat ulang. Jika masih gagal, periksa izin instalasi GitHub App.":"Try reloading. If the problem persists, check the GitHub App installation permissions.",
      "Masuk sebagai":"Signed in as","Keluar":"Sign out","Chat guest hanya ada di halaman ini dan hilang saat dimuat ulang. Masuk dengan Google untuk menyimpan riwayat permanen.":"Guest chats exist only on this page and disappear after reload. Sign in with Google to save history permanently.",
      "Memuat penggunaan…":"Loading usage…","Penggunaan belum dapat ditampilkan.":"Usage cannot be displayed.","Arsip":"Archive","Riwayat akun":"Account history","Sesi ini · Guest Mode":"This session · Guest Mode",
      "Lihat riwayat":"View history","Lihat arsip":"View archive","Percakapan baru":"New conversation","Lepas sematan":"Unpin","Sematkan":"Pin","Pulihkan dari arsip":"Restore from archive","Arsipkan":"Archive","Ubah judul":"Rename",
      "Tidak ada percakapan yang cocok.":"No conversations match.","Belum ada percakapan yang diarsipkan.":"No archived conversations yet.","Belum ada percakapan.":"No conversations yet.","Muat lebih banyak":"Load more",
      "Pilih file PDF (.pdf).":"Choose a PDF file (.pdf).","Ukuran PDF maksimal 8 MB.":"Maximum PDF size is 8 MB.","File PDF tidak valid.":"The PDF file is invalid.","Membaca…":"Reading…","Memproses PDF…":"Processing PDF…",
      "Pilih file CSV, Excel (.xlsx), atau PowerPoint (.pptx).":"Choose a CSV, Excel (.xlsx), or PowerPoint (.pptx) file.","Ukuran file maksimal 5 MB.":"Maximum file size is 5 MB.","File kosong.":"The file is empty.",
      "PDF berhasil dibaca secara lokal. Tanyakan isinya di kolom chat.":"PDF was read locally. Ask about its contents in the chat.","OCR lokal selesai. Teks PDF siap dianalisis.":"Local OCR completed. PDF text is ready for analysis.",
      "Excel berhasil dibaca secara lokal. Tanyakan analisisnya di kolom chat.":"Excel was read locally. Ask for an analysis in the chat.","CSV berhasil dibaca secara lokal. Tanyakan analisisnya di kolom chat.":"CSV was read locally. Ask for an analysis in the chat.","PowerPoint berhasil dibaca secara lokal. Tanyakan isi slide di kolom chat.":"PowerPoint was read locally. Ask about the slides in the chat.",
      "Pesan tidak boleh kosong.":"The message cannot be empty.","Judul tidak boleh kosong.":"The title cannot be empty.","Judul chat diperbarui.":"Chat title updated.","Chat dihapus":"Chat deleted","Semua riwayat dihapus":"All history deleted",
      "Koneksi GitHub diputuskan.":"GitHub disconnected.","Berhasil masuk dengan Google":"Signed in with Google","Login Google gagal":"Google sign-in failed","Gagal keluar dari akun":"Failed to sign out.",
      "Generator email tidak tersedia.":"Email generator is unavailable.","Instruksi draft email siap. Periksa lalu tekan tombol kirim.":"Email draft instructions are ready. Review them, then press Send."
    },
    es: {
      "Ekspor chat":"Exportar chat","Cetak PDF":"Imprimir PDF","Nada":"Tono","Bahasa Indonesia":"Indonesio","Bahasa Indonesia dan English":"Indonesio e inglés","Siapkan draft di chat":"Preparar borrador en el chat","Edit & kirim":"Editar y enviar","Buat ulang":"Regenerar","Teks":"Texto","PDF / Cetak":"PDF / Imprimir","Kirim feedback":"Enviar comentarios","Feedback tersimpan":"Comentarios guardados","Perbarui feedback":"Actualizar comentarios","Jawaban tidak membantu":"Esta respuesta no fue útil","Tidak membantu":"No útil","Memeriksa koneksi…":"Comprobando la conexión…","Belum terhubung":"No conectado","Arsip":"Archivo","Riwayat akun":"Historial de la cuenta","Sesi ini · Guest Mode":"Esta sesión · Modo invitado","Lihat riwayat":"Ver historial","Lihat arsip":"Ver archivo","Percakapan baru":"Nueva conversación","Lepas sematan":"Desfijar","Sematkan":"Fijar","Pulihkan dari arsip":"Restaurar del archivo","Arsipkan":"Archivar","Ubah judul":"Cambiar título","Tidak ada percakapan yang cocok.":"No hay conversaciones que coincidan.","Belum ada percakapan.":"Aún no hay conversaciones.","Muat lebih banyak":"Cargar más","Membaca…":"Leyendo…","Memproses PDF…":"Procesando PDF…","File kosong.":"El archivo está vacío.","Pesan tidak boleh kosong.":"El mensaje no puede estar vacío.","Judul tidak boleh kosong.":"El título no puede estar vacío.","Judul chat diperbarui.":"Título del chat actualizado.","Chat dihapus":"Chat eliminado","Semua riwayat dihapus":"Todo el historial eliminado"
    },
    fr: {
      "Ekspor chat":"Exporter la conversation","Cetak PDF":"Imprimer en PDF","Nada":"Ton","Bahasa Indonesia":"Indonésien","Bahasa Indonesia dan English":"Indonésien et anglais","Siapkan draft di chat":"Préparer le brouillon dans le chat","Edit & kirim":"Modifier et envoyer","Buat ulang":"Régénérer","Teks":"Texte","PDF / Cetak":"PDF / Imprimer","Kirim feedback":"Envoyer un avis","Feedback tersimpan":"Avis enregistré","Perbarui feedback":"Mettre à jour l’avis","Jawaban tidak membantu":"Cette réponse n’a pas aidé","Tidak membantu":"Pas utile","Memeriksa koneksi…":"Vérification de la connexion…","Belum terhubung":"Non connecté","Arsip":"Archives","Riwayat akun":"Historique du compte","Sesi ini · Guest Mode":"Cette session · Mode invité","Lihat riwayat":"Voir l’historique","Lihat arsip":"Voir les archives","Percakapan baru":"Nouvelle conversation","Lepas sematan":"Désépingler","Sematkan":"Épingler","Pulihkan dari arsip":"Restaurer des archives","Arsipkan":"Archiver","Ubah judul":"Renommer","Tidak ada percakapan yang cocok.":"Aucune conversation correspondante.","Belum ada percakapan.":"Aucune conversation pour le moment.","Muat lebih banyak":"Charger plus","Membaca…":"Lecture…","Memproses PDF…":"Traitement du PDF…","File kosong.":"Le fichier est vide.","Pesan tidak boleh kosong.":"Le message ne peut pas être vide.","Judul tidak boleh kosong.":"Le titre ne peut pas être vide.","Judul chat diperbarui.":"Titre de la conversation mis à jour.","Chat dihapus":"Conversation supprimée","Semua riwayat dihapus":"Tout l’historique a été supprimé"
    },
    de: {
      "Ekspor chat":"Chat exportieren","Cetak PDF":"PDF drucken","Nada":"Ton","Bahasa Indonesia":"Indonesisch","Bahasa Indonesia dan English":"Indonesisch und Englisch","Siapkan draft di chat":"Entwurf im Chat vorbereiten","Edit & kirim":"Bearbeiten & senden","Buat ulang":"Erneut generieren","Teks":"Text","PDF / Cetak":"PDF / Drucken","Kirim feedback":"Feedback senden","Feedback tersimpan":"Feedback gespeichert","Perbarui feedback":"Feedback aktualisieren","Jawaban tidak membantu":"Diese Antwort war nicht hilfreich","Tidak membantu":"Nicht hilfreich","Memeriksa koneksi…":"Verbindung wird geprüft…","Belum terhubung":"Nicht verbunden","Arsip":"Archiv","Riwayat akun":"Kontoverlauf","Sesi ini · Guest Mode":"Diese Sitzung · Gastmodus","Lihat riwayat":"Verlauf anzeigen","Lihat arsip":"Archiv anzeigen","Percakapan baru":"Neues Gespräch","Lepas sematan":"Pin lösen","Sematkan":"Anheften","Pulihkan dari arsip":"Aus Archiv wiederherstellen","Arsipkan":"Archivieren","Ubah judul":"Umbenennen","Tidak ada percakapan yang cocok.":"Keine passenden Gespräche gefunden.","Belum ada percakapan.":"Noch keine Gespräche vorhanden.","Muat lebih banyak":"Mehr laden","Membaca…":"Wird gelesen…","Memproses PDF…":"PDF wird verarbeitet…","File kosong.":"Die Datei ist leer.","Pesan tidak boleh kosong.":"Die Nachricht darf nicht leer sein.","Judul tidak boleh kosong.":"Der Titel darf nicht leer sein.","Judul chat diperbarui.":"Chat-Titel aktualisiert.","Chat dihapus":"Chat gelöscht","Semua riwayat dihapus":"Gesamten Verlauf gelöscht"
    },
    pt: {
      "Ekspor chat":"Exportar conversa","Cetak PDF":"Imprimir PDF","Nada":"Tom","Bahasa Indonesia":"Indonésio","Bahasa Indonesia dan English":"Indonésio e inglês","Siapkan draft di chat":"Preparar rascunho no chat","Edit & kirim":"Editar e enviar","Buat ulang":"Gerar novamente","Teks":"Texto","PDF / Cetak":"PDF / Imprimir","Kirim feedback":"Enviar feedback","Feedback tersimpan":"Feedback salvo","Perbarui feedback":"Atualizar feedback","Jawaban tidak membantu":"Esta resposta não foi útil","Tidak membantu":"Não foi útil","Memeriksa koneksi…":"Verificando conexão…","Belum terhubung":"Não conectado","Arsip":"Arquivo","Riwayat akun":"Histórico da conta","Sesi ini · Guest Mode":"Esta sessão · Modo visitante","Lihat riwayat":"Ver histórico","Lihat arsip":"Ver arquivo","Percakapan baru":"Nova conversa","Lepas sematan":"Desafixar","Sematkan":"Fixar","Pulihkan dari arsip":"Restaurar do arquivo","Arsipkan":"Arquivar","Ubah judul":"Renomear","Tidak ada percakapan yang cocok.":"Nenhuma conversa correspondente.","Belum ada percakapan.":"Ainda não há conversas.","Muat lebih banyak":"Carregar mais","Membaca…":"Lendo…","Memproses PDF…":"Processando PDF…","File kosong.":"O arquivo está vazio.","Pesan tidak boleh kosong.":"A mensagem não pode ficar vazia.","Judul tidak boleh kosong.":"O título não pode ficar vazio.","Judul chat diperbarui.":"Título da conversa atualizado.","Chat dihapus":"Conversa excluída","Semua riwayat dihapus":"Todo o histórico foi excluído"
    },
    ja: {
      "Ekspor chat":"チャットをエクスポート","Cetak PDF":"PDFを印刷","Nada":"トーン","Bahasa Indonesia":"インドネシア語","Bahasa Indonesia dan English":"インドネシア語と英語","Siapkan draft di chat":"チャットで下書きを準備","Edit & kirim":"編集して送信","Buat ulang":"再生成","Teks":"テキスト","PDF / Cetak":"PDF / 印刷","Kirim feedback":"フィードバックを送信","Feedback tersimpan":"フィードバックを保存しました","Perbarui feedback":"フィードバックを更新","Jawaban tidak membantu":"この回答は役に立ちませんでした","Tidak membantu":"役に立たない","Memeriksa koneksi…":"接続を確認中…","Belum terhubung":"未接続","Arsip":"アーカイブ","Riwayat akun":"アカウント履歴","Sesi ini · Guest Mode":"このセッション · ゲストモード","Lihat riwayat":"履歴を見る","Lihat arsip":"アーカイブを見る","Percakapan baru":"新しい会話","Lepas sematan":"ピン留めを解除","Sematkan":"ピン留め","Pulihkan dari arsip":"アーカイブから復元","Arsipkan":"アーカイブ","Ubah judul":"タイトルを変更","Tidak ada percakapan yang cocok.":"一致する会話はありません。","Belum ada percakapan.":"会話はまだありません。","Muat lebih banyak":"さらに読み込む","Membaca…":"読み込み中…","Memproses PDF…":"PDFを処理中…","File kosong.":"ファイルが空です。","Pesan tidak boleh kosong.":"メッセージを入力してください。","Judul tidak boleh kosong.":"タイトルを入力してください。","Judul chat diperbarui.":"チャットのタイトルを更新しました。","Chat dihapus":"チャットを削除しました","Semua riwayat dihapus":"すべての履歴を削除しました"
    },
    ko: {
      "Ekspor chat":"채팅 내보내기","Cetak PDF":"PDF 인쇄","Nada":"어조","Bahasa Indonesia":"인도네시아어","Bahasa Indonesia dan English":"인도네시아어 및 영어","Siapkan draft di chat":"채팅에서 초안 준비","Edit & kirim":"수정 후 보내기","Buat ulang":"다시 생성","Teks":"텍스트","PDF / Cetak":"PDF / 인쇄","Kirim feedback":"피드백 보내기","Feedback tersimpan":"피드백이 저장되었습니다","Perbarui feedback":"피드백 업데이트","Jawaban tidak membantu":"이 답변은 도움이 되지 않았습니다","Tidak membantu":"도움이 되지 않음","Memeriksa koneksi…":"연결 확인 중…","Belum terhubung":"연결되지 않음","Arsip":"보관함","Riwayat akun":"계정 기록","Sesi ini · Guest Mode":"이 세션 · 게스트 모드","Lihat riwayat":"기록 보기","Lihat arsip":"보관함 보기","Percakapan baru":"새 대화","Lepas sematan":"고정 해제","Sematkan":"고정","Pulihkan dari arsip":"보관함에서 복원","Arsipkan":"보관","Ubah judul":"제목 변경","Tidak ada percakapan yang cocok.":"일치하는 대화가 없습니다.","Belum ada percakapan.":"아직 대화가 없습니다.","Muat lebih banyak":"더 불러오기","Membaca…":"읽는 중…","Memproses PDF…":"PDF 처리 중…","File kosong.":"파일이 비어 있습니다.","Pesan tidak boleh kosong.":"메시지를 입력해 주세요.","Judul tidak boleh kosong.":"제목을 입력해 주세요.","Judul chat diperbarui.":"채팅 제목이 업데이트되었습니다.","Chat dihapus":"채팅이 삭제되었습니다","Semua riwayat dihapus":"모든 기록이 삭제되었습니다"
    },
    zh: {
      "Ekspor chat":"导出聊天","Cetak PDF":"打印 PDF","Nada":"语气","Bahasa Indonesia":"印度尼西亚语","Bahasa Indonesia dan English":"印度尼西亚语和英语","Siapkan draft di chat":"在聊天中准备草稿","Edit & kirim":"编辑并发送","Buat ulang":"重新生成","Teks":"文本","PDF / Cetak":"PDF / 打印","Kirim feedback":"发送反馈","Feedback tersimpan":"反馈已保存","Perbarui feedback":"更新反馈","Jawaban tidak membantu":"此回答没有帮助","Tidak membantu":"没有帮助","Memeriksa koneksi…":"正在检查连接…","Belum terhubung":"未连接","Arsip":"归档","Riwayat akun":"账户历史记录","Sesi ini · Guest Mode":"此会话 · 访客模式","Lihat riwayat":"查看历史记录","Lihat arsip":"查看归档","Percakapan baru":"新对话","Lepas sematan":"取消置顶","Sematkan":"置顶","Pulihkan dari arsip":"从归档中恢复","Arsipkan":"归档","Ubah judul":"重命名","Tidak ada percakapan yang cocok.":"没有匹配的对话。","Belum ada percakapan.":"暂无对话。","Muat lebih banyak":"加载更多","Membaca…":"正在读取…","Memproses PDF…":"正在处理 PDF…","File kosong.":"文件为空。","Pesan tidak boleh kosong.":"消息不能为空。","Judul tidak boleh kosong.":"标题不能为空。","Judul chat diperbarui.":"聊天标题已更新。","Chat dihapus":"聊天已删除","Semua riwayat dihapus":"所有历史记录已删除"
    },
    ar: {
      "Ekspor chat":"تصدير المحادثة","Cetak PDF":"طباعة PDF","Nada":"النبرة","Bahasa Indonesia":"الإندونيسية","Bahasa Indonesia dan English":"الإندونيسية والإنجليزية","Siapkan draft di chat":"إعداد المسودة في المحادثة","Edit & kirim":"تعديل وإرسال","Buat ulang":"إعادة الإنشاء","Teks":"نص","PDF / Cetak":"PDF / طباعة","Kirim feedback":"إرسال الملاحظات","Feedback tersimpan":"تم حفظ الملاحظات","Perbarui feedback":"تحديث الملاحظات","Jawaban tidak membantu":"هذه الإجابة لم تكن مفيدة","Tidak membantu":"غير مفيد","Memeriksa koneksi…":"جارٍ التحقق من الاتصال…","Belum terhubung":"غير متصل","Arsip":"الأرشيف","Riwayat akun":"سجل الحساب","Sesi ini · Guest Mode":"هذه الجلسة · وضع الضيف","Lihat riwayat":"عرض السجل","Lihat arsip":"عرض الأرشيف","Percakapan baru":"محادثة جديدة","Lepas sematan":"إلغاء التثبيت","Sematkan":"تثبيت","Pulihkan dari arsip":"استعادة من الأرشيف","Arsipkan":"أرشفة","Ubah judul":"تغيير العنوان","Tidak ada percakapan yang cocok.":"لا توجد محادثات مطابقة.","Belum ada percakapan.":"لا توجد محادثات بعد.","Muat lebih banyak":"تحميل المزيد","Membaca…":"جارٍ القراءة…","Memproses PDF…":"جارٍ معالجة PDF…","File kosong.":"الملف فارغ.","Pesan tidak boleh kosong.":"لا يمكن أن تكون الرسالة فارغة.","Judul tidak boleh kosong.":"لا يمكن أن يكون العنوان فارغًا.","Judul chat diperbarui.":"تم تحديث عنوان المحادثة.","Chat dihapus":"تم حذف المحادثة","Semua riwayat dihapus":"تم حذف السجل بالكامل"
    }
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
    return extraTranslations[active]?.[value] || locales[active]?.messages[canonical] || (active==="id" ? value : canonical);
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
    const attributeSelector="input[placeholder],textarea[placeholder],button[title],[aria-label]";
    const elements=[];
    if(root.matches?.(attributeSelector)) elements.push(root);
    elements.push(...(root.querySelectorAll?.(attributeSelector)||[]));
    elements.forEach(el=>{
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
    const observer=new MutationObserver(records=>{for(const record of records){if(record.type==="childList"){record.addedNodes.forEach(n=>{if(n.nodeType===Node.TEXT_NODE){if(!shouldSkip(n)){const t=n.nodeValue.trim(),v=translate(t);if(t&&t!==v)n.nodeValue=n.nodeValue.replace(t,v)}}else if(n.nodeType===Node.ELEMENT_NODE)translateTree(n)})}else if(record.type==="characterData"&&!shouldSkip(record.target)){const t=record.target.nodeValue.trim(),v=translate(t);if(t&&t!==v)record.target.nodeValue=record.target.nodeValue.replace(t,v)}else if(record.type==="attributes"){const el=record.target,attr=record.attributeName,value=el.getAttribute(attr);if(value){const translated=translate(value);if(translated!==value)el.setAttribute(attr,translated)}}}});
    observer.observe(document.body,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:["title","aria-label","placeholder"]});
  };
  window.BORLocale={get current(){return active},get preference(){return preference()},get direction(){return locales[active]?.dir||"ltr"},apply,translate};
  if(document.readyState==="loading") document.addEventListener("DOMContentLoaded",init,{once:true}); else init();
})();
