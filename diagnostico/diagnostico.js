(() => {
  "use strict";

  const questions = [
    { key: "tipo_negocio", title: "¿Qué tipo de negocio tienes?", help: "Así entendemos mejor cómo trabajas.", multiple: false, options: ["Tienda o comercio", "Restaurante o cafetería", "Belleza, salud o servicios", "Distribución o mayorista", "Empresa con equipo de campo", "Otro tipo de negocio"] },
    { key: "objetivo", title: "¿Qué te gustaría mejorar primero?", help: "Puedes elegir hasta dos prioridades.", multiple: true, max: 2, options: ["Controlar ventas e inventario", "Recibir pedidos por internet", "Gestionar clientes y citas", "Fidelizar clientes y premiar compras", "Vender a clientes mayoristas", "Organizar rutas y visitas", "Integrar varias áreas del negocio", "Crear una web o catálogo", "Proteger o mejorar mi sistema actual", "Automatizar un proceso específico"] },
    { key: "gestion_actual", title: "¿Cómo gestionas hoy esa parte del negocio?", help: "No hay respuestas buenas o malas.", multiple: false, options: ["WhatsApp y Excel", "Cuadernos o anotaciones", "Varias plataformas que no se conectan", "Un sistema propio o contratado", "Todavía no tengo un proceso definido"] },
    { key: "herramientas", title: "¿Con qué herramientas cuentas actualmente?", help: "Selecciona las que utilizas. Puedes marcar varias.", multiple: true, max: 4, options: ["Página web o tienda online", "Sistema de ventas o inventario", "CRM o base de datos de clientes", "Agenda o sistema de citas", "Excel o Google Sheets", "WhatsApp Business / redes sociales", "Ninguna de estas"] },
    { key: "principal_problema", title: "¿Qué problema te gustaría dejar atrás?", help: "Elige lo que más se parece a tu situación.", multiple: false, options: ["Pierdo tiempo en tareas manuales", "No tengo información clara para decidir", "Se me escapan ventas o clientes", "Me cuesta organizar al equipo", "Mis herramientas no se comunican", "Necesito una solución hecha a mi medida"] }
  ];

  const recommendations = {
    ventas: { name: "Nivo Ventas", desc: "Para ordenar el registro de ventas y el control operativo de tu negocio.", detail: "Podemos revisar cómo llevas tus ventas e inventario y qué parte conviene centralizar.", tags: ["Ventas", "Inventario"] },
    pedidos: { name: "Nivo Pedidos", desc: "Para recibir pedidos digitales de forma más ordenada y facilitar la atención de tus clientes.", detail: "Una experiencia de pedidos propia puede reducir el intercambio manual de mensajes y errores al tomar pedidos.", tags: ["Pedidos online", "Atención"] },
    agenda: { name: "Nivo CRM", desc: "Para organizar la información de tus clientes y dar seguimiento a tus oportunidades.", detail: "Podemos revisar cómo centralizar tus contactos y mejorar el seguimiento comercial. Si necesitas agenda de citas, evaluaremos ese alcance por separado.", tags: ["Clientes", "Seguimiento"] },
    puntos: { name: "Nivo Puntos", desc: "Para incentivar que tus clientes regresen mediante un programa de fidelización.", detail: "Puedes implementar una experiencia de puntos y beneficios para fortalecer la recurrencia.", tags: ["Fidelización", "Clientes"] },
    mayoristas: { name: "Nivo Mayoristas", desc: "Para ordenar pedidos y la atención de tus clientes mayoristas.", detail: "Una plataforma orientada a tus clientes B2B puede simplificar la toma y gestión de pedidos.", tags: ["B2B", "Pedidos"] },
    ruta: { name: "Nivo Ruta", desc: "Para organizar las visitas y actividades de tu equipo en campo.", detail: "Podemos ayudarte a tener mayor orden y seguimiento de las actividades fuera de oficina.", tags: ["Equipo de campo", "Seguimiento"] },
    erp: { name: "Nivo ERP", desc: "Para evaluar una solución que conecte procesos y áreas de tu empresa.", detail: "Cuando varias áreas necesitan compartir información, conviene revisar los procesos antes de definir el alcance del sistema.", tags: ["Procesos", "Integración"] },
    web: { name: "Nivo Development", desc: "Para crear una página web, catálogo digital o plataforma adaptada a tu negocio.", detail: "Diseñamos una solución digital de acuerdo con tus objetivos, contenido y forma de trabajar.", tags: ["Web", "Desarrollo"] },
    care: { name: "Nivo Care", desc: "Para mantener y cuidar la infraestructura, web o sistema que ya utilizas.", detail: "Podemos revisar mantenimiento, respaldos, actualizaciones y medidas de seguridad.", tags: ["Mantenimiento", "Seguridad"] },
    automatizacion: { name: "Nivo Development", desc: "Para diseñar una automatización o sistema a medida para tu proceso.", detail: "Primero identificamos el flujo que quieres mejorar y luego definimos la solución más simple y sostenible.", tags: ["Automatización", "A medida"] }
  };

  const $ = (id) => document.getElementById(id);
  const answers = {};
  let step = 0;
  let currentRecommendation = null;

  const form = $("diagnostic-form");
  const questionArea = $("question-area");
  const nextBtn = $("next-btn");
  const backBtn = $("back-btn");

  function selectedValues(question) {
    return Array.isArray(answers[question.key]) ? answers[question.key] : (answers[question.key] ? [answers[question.key]] : []);
  }

  function renderQuestion() {
    const q = questions[step];
    const selected = selectedValues(q);
    $("step-label").textContent = "PREGUNTA " + (step + 1) + " DE " + questions.length;
    $("progress-percent").textContent = Math.round(((step + 1) / questions.length) * 100) + "%";
    $("progress-bar").style.width = ((step + 1) / questions.length * 100) + "%";
    backBtn.hidden = step === 0;
    nextBtn.textContent = step === questions.length - 1 ? "Ver mi recomendación →" : "Continuar →";
    questionArea.innerHTML = "";
    const kicker = document.createElement("div"); kicker.className = "question-kicker"; kicker.textContent = "Conozcamos tu negocio";
    const title = document.createElement("h2"); title.className = "question-title"; title.id = "question-title"; title.textContent = q.title;
    const help = document.createElement("p"); help.className = "question-help"; help.textContent = q.help;
    const validation = document.createElement("p"); validation.className = "form-status error"; validation.id = "question-error"; validation.hidden = true; validation.textContent = "Selecciona una respuesta para continuar.";
    const options = document.createElement("div"); options.className = "options";
    q.options.forEach((option, index) => {
      const label = document.createElement("label"); label.className = "option" + (selected.includes(option) ? " selected" : "");
      label.dataset.multiple = String(q.multiple);
      const input = document.createElement("input"); input.type = q.multiple ? "checkbox" : "radio"; input.name = q.key; input.value = option; input.checked = selected.includes(option);
      const mark = document.createElement("span"); mark.className = "option-mark"; mark.setAttribute("aria-hidden", "true");
      const text = document.createElement("span"); text.className = "option-text"; text.textContent = option;
      label.append(input, mark, text);
      label.addEventListener("click", (event) => {
        event.preventDefault();
        let values = selectedValues(q);
        if (q.multiple) {
          values = values.includes(option) ? values.filter(v => v !== option) : (values.length < q.max ? [...values, option] : values);
        } else values = [option];
        answers[q.key] = q.multiple ? values : values[0];
        renderQuestion();
      });
      options.appendChild(label);
    });
    questionArea.append(kicker, title, help, options, validation);
  }

  function calculateRecommendation() {
    const goals = answers.objetivo || [];
    const business = answers.tipo_negocio || "";
    const tools = answers.herramientas || [];
    const problem = answers.principal_problema || "";
    if (goals.includes("Integrar varias áreas del negocio")) return recommendations.erp;
    if (goals.includes("Vender a clientes mayoristas") || business.includes("mayorista") || business.includes("Distribución")) return recommendations.mayoristas;
    if (goals.includes("Organizar rutas y visitas") || business.includes("campo")) return recommendations.ruta;
    if (goals.includes("Fidelizar clientes y premiar compras")) return recommendations.puntos;
    if (goals.includes("Gestionar clientes y citas")) return recommendations.agenda;
    if (goals.includes("Recibir pedidos por internet")) return recommendations.pedidos;
    if (goals.includes("Controlar ventas e inventario")) return recommendations.ventas;
    if (goals.includes("Crear una web o catálogo")) return recommendations.web;
    if (goals.includes("Proteger o mejorar mi sistema actual")) return recommendations.care;
    if (goals.includes("Automatizar un proceso específico") || problem.includes("automatización") || problem.includes("tareas manuales")) return recommendations.automatizacion;
    if (tools.includes("Página web o tienda online") || tools.includes("Sistema de ventas o inventario")) return recommendations.care;
    return recommendations.web;
  }

  function showResult() {
    currentRecommendation = calculateRecommendation();
    $("progress-bar").style.width = "100%";
    $("progress-percent").textContent = "100%";
    $("step-label").textContent = "DIAGNÓSTICO COMPLETADO";
    form.querySelector(".actions").hidden = true;
    form.querySelector(".privacy-note").hidden = true;
    questionArea.hidden = true;
    const result = $("result-area");
    result.hidden = false;
    const top = document.createElement("div"); top.className = "result-top";
    const kicker = document.createElement("span"); kicker.className = "eyebrow"; kicker.textContent = "TU RECOMENDACIÓN INICIAL";
    const title = document.createElement("h2"); title.textContent = currentRecommendation.name;
    const desc = document.createElement("p"); desc.textContent = currentRecommendation.desc;
    top.append(kicker, title, desc);
    const explain = document.createElement("p"); explain.className = "result-explain"; explain.textContent = currentRecommendation.detail;
    const label = document.createElement("div"); label.className = "result-label"; label.textContent = "LO QUE IDENTIFICAMOS";
    const pills = document.createElement("div"); pills.className = "result-pills";
    currentRecommendation.tags.forEach(tag => { const item = document.createElement("span"); item.textContent = tag; pills.append(item); });
    result.replaceChildren(top, explain, label, pills);
    $("lead-area").hidden = false;
    $("lead-area").scrollIntoView({behavior:"smooth",block:"start"});
  }

  nextBtn.addEventListener("click", () => {
    const q = questions[step];
    if (!selectedValues(q).length) {
      const validation = $("question-error");
      if (validation) validation.hidden = false;
      return;
    }
    if (step < questions.length - 1) { step++; renderQuestion(); }
    else showResult();
  });
  backBtn.addEventListener("click", () => { if (step > 0) { step--; renderQuestion(); } });

  $("lead-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const leadForm = event.currentTarget;
    if (!leadForm.reportValidity()) return;
    const data = new FormData(leadForm);
    const status = $("form-status");
    if (data.get("website")) return;
    const payload = {
      nombre: String(data.get("nombre") || "").trim(),
      negocio: String(data.get("negocio") || "").trim(),
      whatsapp: String(data.get("whatsapp") || "").trim(),
      email: String(data.get("email") || "").trim() || null,
      respuestas: answers,
      recomendacion: currentRecommendation?.name || null,
      consentimiento: data.get("consentimiento") === "on",
      origen: "diagnostico_web"
    };
    status.className = "form-status";
    status.textContent = "Enviando tus respuestas…";
    const submit = leadForm.querySelector("button[type=submit]");
    submit.disabled = true;
    try {
      const config = window.NIVO_DIAG_CONFIG;
      if (!config?.supabaseUrl || !config?.publishableKey) throw new Error("Falta configurar el servicio.");
      const response = await fetch(config.supabaseUrl + "/rest/v1/rpc/registrar_prospecto_nivo", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": config.publishableKey
        },
        body: JSON.stringify({p_datos: payload})
      });
      if (!response.ok) throw new Error("No se pudo registrar el diagnóstico.");
      status.className = "form-status success";
      status.textContent = "¡Gracias! Recibimos tus respuestas. Pronto nos pondremos en contacto contigo.";
      submit.textContent = "Enviado correctamente ✓";
      leadForm.querySelectorAll("input,button").forEach(el => { el.disabled = true; });
    } catch (error) {
      status.className = "form-status error";
      status.textContent = "No pudimos enviar tus datos en este momento. Inténtalo nuevamente o escríbenos por WhatsApp.";
      submit.disabled = false;
    }
  });

  renderQuestion();
})();