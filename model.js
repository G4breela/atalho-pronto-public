const defaultSnippets = [
  { name: "oi", body: "Olá! Tudo bem? Como posso ajudar?" },
  { name: "retorno", body: "Recebi sua mensagem e já estou verificando. Assim que tiver uma atualização, aviso por aqui." },
  { name: "hoje", body: "{{data}}" }
];

const snippetKey = "snippets";
const namePattern = /^[a-z0-9_-]{1,40}$/;
const suffixPattern = /(?:^|\s)\/([a-z0-9_-]{1,40})$/i;

function futureHour(now) {
  const hourInMilliseconds = 3_600_000;
  const future = new Date(now.getTime() + 4 * hourInMilliseconds);

  // Use local clock time, including when an offset changes during rounding.
  for (;;) {
    const elapsed = (future.getMinutes() * 60 + future.getSeconds()) * 1000 + future.getMilliseconds();
    if (!elapsed) return future;
    future.setTime(future.getTime() + hourInMilliseconds - elapsed);
  }
}

function fillTemplate(body, now = new Date()) {
  return body.replace(/\{\{(data|hora|hora\+4)\}\}/g, (_, token) => {
    if (token === "data") return now.toLocaleDateString("pt-BR");
    const time = token === "hora+4" ? futureHour(now) : now;
    return time.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  });
}
