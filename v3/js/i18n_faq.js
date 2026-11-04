// FAQ panel strings. Extends NH_I18N_GAME (must load after i18n_game.js, before i18n.js). Missing languages fall back to English.
(function (g) {
  const G = g.NH_I18N_GAME = g.NH_I18N_GAME || {};
  const add = (lang, o) => { G[lang] = Object.assign(G[lang] || {}, o); };
  add("en", { faq_btn: "FAQ", faq_title: "How to play",
    faq_q1: "How do I get a building?", faq_a1: "Follow us, type your handle, pick your country and post the NH-code in a reel comment. After verification you get a plot and a starter tower.",
    faq_q2: "How do levels work?", faq_a2: "You earn XP from daily logins, upgrades, collecting business income, likes, visits, referrals and quests. Each level needs more XP than the last (100 × level^1.5), up to level 100. Levels unlock new businesses, plots and cosmetics.",
    faq_q3: "How do businesses work?", faq_a3: "Build businesses on your extra plots. They earn coins every hour into a storage that has a cap, so tap to collect regularly. Upgrade them for more income, bigger storage and a grander look.",
    faq_q4: "How do referrals work?", faq_a4: "Share your personal link. A friend counts only after they register AND pass the follow check. Rewards: 1 friend = 100 coins, 3 = neon colour, 5 = a free premium upgrade, 10 = Ambassador crown, 25 = landmark plot. Unfollow within 7 days revokes it.",
    faq_q5: "What are quests and coins for?", faq_a5: "Quests and the daily check-in streak give coins. Spend coins on height, facades, neon, rooftops and interiors. Premium specials cost $0.99 and are cosmetic only.",
    faq_q6: "What if I unfollow?", faq_a6: "Your building is locked (dimmed, scaffolding) for a grace period. Re-follow and it is restored.",
    faq_credits: "3D model credits" });
  add("ru", { faq_btn: "FAQ", faq_title: "Как играть",
    faq_q1: "Как получить здание?", faq_a1: "Подпишись на нас, введи свой ник, выбери страну и оставь код NH-… в комментарии под рилсом. После проверки получишь участок и стартовую башню.",
    faq_q2: "Как работают уровни?", faq_a2: "Опыт даётся за ежедневный вход, улучшения, сбор дохода бизнесов, лайки, визиты, рефералов и квесты. Каждый следующий уровень требует больше опыта (100 × уровень^1.5), максимум — 100. Уровни открывают бизнесы, участки и украшения.",
    faq_q3: "Как работают бизнесы?", faq_a3: "Строй бизнесы на дополнительных участках. Они приносят монеты каждый час в хранилище с лимитом — заходи и собирай. Улучшай ради дохода, хранилища и более роскошного вида.",
    faq_q4: "Как работают рефералы?", faq_a4: "Поделись личной ссылкой. Друг засчитывается, только когда зарегистрируется И пройдёт проверку подписки. Награды: 1 друг = 100 монет, 3 = цвет неона, 5 = бесплатное премиум-улучшение, 10 = корона Посла, 25 = знаковый участок. Отписка в течение 7 дней отменяет награду.",
    faq_q5: "Зачем квесты и монеты?", faq_a5: "Квесты и ежедневная серия дают монеты. Трать их на высоту, фасады, неон, крыши и интерьер. Премиум-предметы стоят $0.99 и только косметические.",
    faq_q6: "Что если отписаться?", faq_a6: "Здание блокируется (затемнено, в лесах) на время отсрочки. Подпишись снова — и оно вернётся.",
    faq_credits: "Авторы 3D-моделей" });
  add("es", { faq_btn: "FAQ", faq_title: "Cómo jugar",
    faq_q1: "¿Cómo consigo un edificio?", faq_a1: "Síguenos, escribe tu usuario, elige tu país y publica el código NH-… en un comentario del reel. Tras la verificación recibes una parcela y una torre inicial.",
    faq_q2: "¿Cómo funcionan los niveles?", faq_a2: "Ganas XP con el acceso diario, mejoras, ingresos de negocios, likes, visitas, referidos y misiones. Cada nivel pide más XP que el anterior (100 × nivel^1.5), hasta el 100. Los niveles desbloquean negocios, parcelas y cosméticos.",
    faq_q3: "¿Cómo funcionan los negocios?", faq_a3: "Construye negocios en parcelas extra. Generan monedas cada hora en un almacén con tope, así que recógelas con frecuencia. Mejóralos para más ingresos, más almacén y mejor aspecto.",
    faq_q4: "¿Cómo funcionan los referidos?", faq_a4: "Comparte tu enlace. Un amigo cuenta solo si se registra Y pasa la verificación de seguimiento. Premios: 1 amigo = 100 monedas, 3 = color neón, 5 = mejora premium gratis, 10 = corona de Embajador, 25 = parcela emblemática. Dejar de seguir en 7 días lo revoca.",
    faq_q5: "¿Para qué sirven misiones y monedas?", faq_a5: "Las misiones y la racha diaria dan monedas. Gástalas en altura, fachadas, neón, azoteas e interiores. Los extras premium cuestan $0.99 y son solo cosméticos.",
    faq_q6: "¿Y si dejo de seguir?", faq_a6: "Tu edificio se bloquea (oscurecido, con andamios) durante un periodo de gracia. Vuelve a seguir y se restaura.",
    faq_credits: "Créditos de modelos 3D" });
  add("uk", { faq_btn: "FAQ", faq_title: "Як грати",
    faq_q1: "Як отримати будівлю?", faq_a1: "Підпишись на нас, введи свій нік, обери країну та залиш код NH-… у коментарі під рілсом. Після перевірки отримаєш ділянку та стартову вежу.",
    faq_q2: "Як працюють рівні?", faq_a2: "Досвід дають щоденний вхід, покращення, збір доходу бізнесів, лайки, візити, реферали та квести. Кожен рівень потребує більше досвіду (100 × рівень^1.5), максимум — 100. Рівні відкривають бізнеси, ділянки й косметику.",
    faq_q3: "Як працюють бізнеси?", faq_a3: "Будуй бізнеси на додаткових ділянках. Вони щогодини приносять монети у сховище з лімітом — заходь і збирай. Покращуй заради доходу, сховища та кращого вигляду.",
    faq_q4: "Як працюють реферали?", faq_a4: "Поділись особистим посиланням. Друг зараховується лише після реєстрації І перевірки підписки. Нагороди: 1 друг = 100 монет, 3 = колір неону, 5 = безкоштовне преміум-покращення, 10 = корона Посла, 25 = знакова ділянка. Відписка за 7 днів скасовує нагороду.",
    faq_q5: "Навіщо квести та монети?", faq_a5: "Квести й щоденна серія дають монети. Витрачай їх на висоту, фасади, неон, дахи та інтер'єр. Преміум-речі коштують $0.99 і лише косметичні.",
    faq_q6: "А якщо відписатись?", faq_a6: "Будівля блокується (затемнена, у риштуванні) на пільговий період. Підпишись знову — і вона повернеться.",
    faq_credits: "Автори 3D-моделей" });
  add("pt", { faq_btn: "FAQ", faq_title: "Como jogar",
    faq_q1: "Como consigo um prédio?", faq_a1: "Siga-nos, digite seu usuário, escolha o país e publique o código NH-… num comentário do reel. Após a verificação você recebe um terreno e uma torre inicial.",
    faq_q2: "Como funcionam os níveis?", faq_a2: "Você ganha XP com login diário, melhorias, renda dos negócios, curtidas, visitas, indicações e missões. Cada nível exige mais XP que o anterior (100 × nível^1.5), até o 100. Níveis liberam negócios, terrenos e cosméticos.",
    faq_q3: "Como funcionam os negócios?", faq_a3: "Construa negócios em terrenos extras. Eles rendem moedas por hora num estoque com limite, então colete sempre. Melhore para mais renda, mais estoque e visual mais imponente.",
    faq_q4: "Como funcionam as indicações?", faq_a4: "Compartilhe seu link. Um amigo só conta ao se cadastrar E passar na verificação de seguir. Prêmios: 1 amigo = 100 moedas, 3 = cor neon, 5 = melhoria premium grátis, 10 = coroa de Embaixador, 25 = terreno icônico. Deixar de seguir em 7 dias revoga.",
    faq_q5: "Para que servem missões e moedas?", faq_a5: "Missões e a sequência diária dão moedas. Gaste em altura, fachadas, neon, coberturas e interiores. Itens premium custam $0.99 e são só cosméticos.",
    faq_q6: "E se eu deixar de seguir?", faq_a6: "Seu prédio fica bloqueado (escurecido, com andaimes) durante a carência. Siga de novo e ele volta.",
    faq_credits: "Créditos dos modelos 3D" });
})(window);
