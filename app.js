'use strict';

/*
 * Conversor de Horário BR / PT / MY / KR / US
 *
 * Regra central: o estado canônico do app é um INSTANTE em UTC (milissegundos).
 * Os campos de data e hora são apenas uma *visão* desse instante no fuso do país
 * escolhido como referência — nunca a fonte da verdade. É isso que permite trocar
 * o país mestre sem resetar nada e sobreviver às viradas de horário de verão.
 */

// ---------------------------------------------------------------------------
// Configuração
// ---------------------------------------------------------------------------

// Todos os países usam fuso IANA, inclusive o Brasil (que hoje não tem horário
// de verão). Assim não existe caminho de código especial e, se o DST voltar,
// o navegador se atualiza sozinho sem mudança no app.
const PAISES = {
  BR: { nome: 'Brasil', cidade: 'Brasília', fuso: 'America/Sao_Paulo', hora12: false },
  PT: { nome: 'Portugal', cidade: 'Lisboa', fuso: 'Europe/Lisbon', hora12: false },
  MY: { nome: 'Malásia', cidade: 'Kuala Lumpur', fuso: 'Asia/Kuala_Lumpur', hora12: true },
  KR: { nome: 'Coreia do Sul', cidade: 'Seul', fuso: 'Asia/Seoul', hora12: true },
  US: { nome: 'EUA', cidade: 'Nova York', fuso: 'America/New_York', hora12: true },
};

const ORDEM_PAISES = ['BR', 'PT', 'MY', 'KR', 'US'];
const CHAVE_ARMAZENAMENTO = 'conversor-horario:estado';

const estado = {
  paisMestre: 'BR',
  instanteUTC: Date.now(),
  modoAoVivo: true,
};

// ---------------------------------------------------------------------------
// Elementos da página
// ---------------------------------------------------------------------------

const seletorPais = document.getElementById('seletor-pais');
const campoData = document.getElementById('campo-data');
const campoHora = document.getElementById('campo-hora');
const botaoAgora = document.getElementById('botao-agora');
const indicadorModo = document.getElementById('indicador-modo');
const gradeCards = document.getElementById('grade-cards');
const mensagemErro = document.getElementById('mensagem-erro');

// Referências dos elementos de cada card, pra atualizar só o texto a cada tick
// em vez de reconstruir o DOM inteiro uma vez por segundo.
const cardsPorPais = new Map();

// ---------------------------------------------------------------------------
// Conversão de fuso horário
// ---------------------------------------------------------------------------

// Criar Intl.DateTimeFormat é caro; com tick de 1s vale a pena reaproveitar.
const cacheFormatadores = new Map();

/**
 * Devolve (e memoriza) o formatador usado pra ler as partes de uma data num fuso.
 * @param {string} fuso Identificador IANA, ex.: 'America/Sao_Paulo'.
 * @returns {Intl.DateTimeFormat}
 */
function obterFormatador(fuso) {
  let formatador = cacheFormatadores.get(fuso);
  if (formatador === undefined) {
    formatador = new Intl.DateTimeFormat('en-US', {
      timeZone: fuso,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    cacheFormatadores.set(fuso, formatador);
  }
  return formatador;
}

/**
 * Lê um instante UTC como data/hora local de um fuso, em partes numéricas.
 * @param {string} fuso Identificador IANA.
 * @param {number} instante Milissegundos desde a época (UTC).
 * @returns {{ano: number, mes: number, dia: number, hora: number, minuto: number, segundo: number}}
 */
function extrairPartes(fuso, instante) {
  const partes = obterFormatador(fuso).formatToParts(new Date(instante));
  const valores = {};
  for (const parte of partes) {
    if (parte.type !== 'literal') {
      valores[parte.type] = parte.value;
    }
  }
  return {
    ano: Number(valores.year),
    mes: Number(valores.month),
    dia: Number(valores.day),
    // Alguns motores devolvem "24" para meia-noite; o resto normaliza pra 0.
    hora: Number(valores.hour) % 24,
    minuto: Number(valores.minute),
    segundo: Number(valores.second),
  };
}

/**
 * Descobre o offset de um fuso (em minutos) num instante específico.
 * Positivo a leste de Greenwich. Já considera horário de verão.
 * @param {string} fuso Identificador IANA.
 * @param {number} instante Milissegundos desde a época (UTC).
 * @returns {number} Offset em minutos.
 */
function obterOffsetMinutos(fuso, instante) {
  const partes = extrairPartes(fuso, instante);
  const comoSeFosseUTC = Date.UTC(
    partes.ano, partes.mes - 1, partes.dia,
    partes.hora, partes.minuto, partes.segundo,
  );
  // As partes formatadas não têm milissegundos — truncar dos dois lados.
  const instanteSemMilissegundos = Math.floor(instante / 1000) * 1000;
  return (comoSeFosseUTC - instanteSemMilissegundos) / 60000;
}

/**
 * Converte uma data/hora digitada (relógio de parede local) no instante UTC
 * correspondente. Faz duas passadas: a segunda cobre os dias em que o offset
 * muda dentro do próprio dia (viradas de horário de verão).
 *
 * Em horários ambíguos ou inexistentes (as 2 viradas anuais de PT e US) a
 * função resolve silenciosamente pra um dos valores possíveis — decisão
 * consciente, registrada no handoff.
 *
 * @param {string} fuso Identificador IANA.
 * @param {number} ano Ano com 4 dígitos.
 * @param {number} mes Mês de 1 a 12.
 * @param {number} dia Dia do mês.
 * @param {number} hora Hora de 0 a 23.
 * @param {number} minuto Minuto de 0 a 59.
 * @returns {number} Instante em milissegundos desde a época (UTC).
 */
function converterLocalParaUTC(fuso, ano, mes, dia, hora, minuto) {
  const palpite = Date.UTC(ano, mes - 1, dia, hora, minuto, 0);
  const primeiraTentativa = palpite - obterOffsetMinutos(fuso, palpite) * 60000;
  return palpite - obterOffsetMinutos(fuso, primeiraTentativa) * 60000;
}

// ---------------------------------------------------------------------------
// Formatação
// ---------------------------------------------------------------------------

/**
 * Completa um número com zero à esquerda.
 * @param {number} valor Número a formatar.
 * @returns {string}
 */
function doisDigitos(valor) {
  return String(valor).padStart(2, '0');
}

/**
 * Monta a data no formato ISO (YYYY-MM-DD), usado pelo input de data e pela
 * comparação de dias entre países.
 * @param {{ano: number, mes: number, dia: number}} partes Partes da data.
 * @returns {string}
 */
function formatarDataISO(partes) {
  return `${partes.ano}-${doisDigitos(partes.mes)}-${doisDigitos(partes.dia)}`;
}

/**
 * Formata a hora respeitando o padrão do país (24h ou 12h com AM/PM).
 * O AM/PM é derivado da hora em vez de lido do locale, pra não variar entre
 * navegadores.
 * @param {{hora: number, minuto: number}} partes Partes da hora.
 * @param {boolean} hora12 Verdadeiro para formato de 12 horas.
 * @returns {{principal: string, sufixo: string}}
 */
function formatarHora(partes, hora12) {
  if (!hora12) {
    return { principal: `${doisDigitos(partes.hora)}:${doisDigitos(partes.minuto)}`, sufixo: '' };
  }
  const hora = partes.hora % 12 === 0 ? 12 : partes.hora % 12;
  const periodo = partes.hora < 12 ? 'AM' : 'PM';
  return { principal: `${hora}:${doisDigitos(partes.minuto)}`, sufixo: periodo };
}

/**
 * Escreve o offset de forma legível, ex.: 'UTC+09:00'. Torna o horário de verão
 * observável — ajuda a confiar no resultado justamente quando ele muda.
 * @param {number} minutos Offset em minutos.
 * @returns {string}
 */
function formatarOffset(minutos) {
  const sinal = minutos < 0 ? '−' : '+';
  const absoluto = Math.abs(minutos);
  return `UTC${sinal}${doisDigitos(Math.floor(absoluto / 60))}:${doisDigitos(absoluto % 60)}`;
}

/**
 * Diferença em dias inteiros entre duas datas, comparadas em UTC.
 * Nunca comparar strings de data direto nem usar o fuso local do navegador.
 * @param {{ano: number, mes: number, dia: number}} partesA Data do país do card.
 * @param {{ano: number, mes: number, dia: number}} partesB Data do país mestre.
 * @returns {number} Diferença em dias (pode ser negativa).
 */
function diferencaEmDias(partesA, partesB) {
  const diaA = Date.UTC(partesA.ano, partesA.mes - 1, partesA.dia);
  const diaB = Date.UTC(partesB.ano, partesB.mes - 1, partesB.dia);
  return Math.round((diaA - diaB) / 86400000);
}

/**
 * Texto da etiqueta de diferença de dias. Genérico de propósito: com os fusos
 * atuais nunca passa de ±1 dia, mas não quebra se um país for adicionado.
 * @param {number} diferenca Diferença em dias.
 * @returns {string}
 */
function descreverDiferencaDeDias(diferenca) {
  if (diferenca === 0) {
    return 'mesmo dia';
  }
  const plural = Math.abs(diferenca) === 1 ? 'dia' : 'dias';
  return diferenca > 0 ? `+${diferenca} ${plural}` : `−${Math.abs(diferenca)} ${plural}`;
}

// ---------------------------------------------------------------------------
// Persistência
// ---------------------------------------------------------------------------

/** Salva o estado atual. Falha em silêncio: o app funciona sem persistência. */
function salvarEstado() {
  try {
    localStorage.setItem(CHAVE_ARMAZENAMENTO, JSON.stringify({
      paisMestre: estado.paisMestre,
      instanteUTC: estado.instanteUTC,
      modoAoVivo: estado.modoAoVivo,
    }));
  } catch (erro) {
    console.warn('[conversor] não foi possível salvar o estado', erro);
  }
}

/** Restaura o estado da sessão anterior, ignorando dados inválidos. */
function restaurarEstado() {
  try {
    const bruto = localStorage.getItem(CHAVE_ARMAZENAMENTO);
    if (!bruto) {
      return;
    }
    const salvo = JSON.parse(bruto);
    if (typeof salvo.paisMestre === 'string' && PAISES[salvo.paisMestre] !== undefined) {
      estado.paisMestre = salvo.paisMestre;
    }
    estado.modoAoVivo = salvo.modoAoVivo !== false;
    // No modo ao vivo o instante salvo é irrelevante — sempre parte de agora.
    if (!estado.modoAoVivo && Number.isFinite(salvo.instanteUTC)) {
      estado.instanteUTC = salvo.instanteUTC;
    }
  } catch (erro) {
    console.warn('[conversor] estado salvo inválido, começando do zero', erro);
  }
}

// ---------------------------------------------------------------------------
// Mensagens de erro
// ---------------------------------------------------------------------------

/**
 * Mostra uma mensagem de erro na tela.
 * @param {string} texto Mensagem legível pro usuário.
 */
function mostrarErro(texto) {
  mensagemErro.textContent = texto;
  mensagemErro.hidden = false;
}

/** Esconde a mensagem de erro. */
function limparErro() {
  mensagemErro.hidden = true;
  mensagemErro.textContent = '';
}

// ---------------------------------------------------------------------------
// Montagem e atualização da tela
// ---------------------------------------------------------------------------

/** Preenche o seletor de país de referência. */
function montarSeletor() {
  for (const codigo of ORDEM_PAISES) {
    const opcao = document.createElement('option');
    opcao.value = codigo;
    opcao.textContent = `${PAISES[codigo].nome} (${PAISES[codigo].cidade})`;
    seletorPais.appendChild(opcao);
  }
  seletorPais.value = estado.paisMestre;
}

/**
 * Reconstrói os cards. Só é chamado na inicialização e quando o país mestre
 * muda — o tick de 1s atualiza apenas os textos.
 */
function reconstruirCards() {
  gradeCards.innerHTML = '';
  cardsPorPais.clear();

  for (const codigo of ORDEM_PAISES) {
    if (codigo === estado.paisMestre) {
      continue;
    }
    const pais = PAISES[codigo];

    const card = document.createElement('article');
    card.className = 'card';

    const titulo = document.createElement('h2');
    titulo.className = 'card-titulo';
    titulo.textContent = pais.nome;

    const cidade = document.createElement('p');
    cidade.className = 'card-cidade';
    cidade.textContent = pais.cidade;

    const linhaHora = document.createElement('p');
    linhaHora.className = 'card-hora';

    const horaPrincipal = document.createElement('span');
    horaPrincipal.className = 'hora-principal';

    const horaSegundos = document.createElement('span');
    horaSegundos.className = 'hora-segundos';

    const horaSufixo = document.createElement('span');
    horaSufixo.className = 'hora-sufixo';

    linhaHora.append(horaPrincipal, horaSegundos, horaSufixo);

    const rodapeCard = document.createElement('div');
    rodapeCard.className = 'card-rodape';

    const etiquetaDia = document.createElement('span');
    etiquetaDia.className = 'etiqueta-dia';

    const textoOffset = document.createElement('span');
    textoOffset.className = 'card-offset';

    rodapeCard.append(etiquetaDia, textoOffset);
    card.append(titulo, cidade, linhaHora, rodapeCard);
    gradeCards.appendChild(card);

    cardsPorPais.set(codigo, { horaPrincipal, horaSegundos, horaSufixo, etiquetaDia, textoOffset });
  }
}

/**
 * Escreve num input sem atrapalhar o usuário: se o campo está em foco (ele está
 * digitando), não sobrescreve.
 * @param {HTMLInputElement} campo Campo a atualizar.
 * @param {string} valor Novo valor.
 */
function atualizarCampo(campo, valor) {
  if (document.activeElement !== campo && campo.value !== valor) {
    campo.value = valor;
  }
}

/**
 * Atualiza a linha que indica o modo atual (ao vivo ou fixo).
 * @param {{hora: number, minuto: number, segundo: number}} partesMestre Hora do país mestre.
 */
function atualizarIndicadorModo(partesMestre) {
  if (estado.modoAoVivo) {
    const relogio = `${doisDigitos(partesMestre.hora)}:${doisDigitos(partesMestre.minuto)}:${doisDigitos(partesMestre.segundo)}`;
    indicadorModo.textContent = `Ao vivo · ${relogio}`;
    indicadorModo.classList.add('ao-vivo');
  } else {
    indicadorModo.textContent = 'Horário fixo · toque em "Agora" pra voltar ao tempo real';
    indicadorModo.classList.remove('ao-vivo');
  }
}

/** Recalcula e redesenha tudo a partir do instante em estado.instanteUTC. */
function renderizar() {
  try {
    const fusoMestre = PAISES[estado.paisMestre].fuso;
    const partesMestre = extrairPartes(fusoMestre, estado.instanteUTC);

    atualizarCampo(campoData, formatarDataISO(partesMestre));
    atualizarCampo(campoHora, `${doisDigitos(partesMestre.hora)}:${doisDigitos(partesMestre.minuto)}`);
    atualizarIndicadorModo(partesMestre);

    for (const [codigo, elementos] of cardsPorPais) {
      const pais = PAISES[codigo];
      const partes = extrairPartes(pais.fuso, estado.instanteUTC);
      const hora = formatarHora(partes, pais.hora12);
      const diferenca = diferencaEmDias(partes, partesMestre);

      elementos.horaPrincipal.textContent = hora.principal;
      elementos.horaSegundos.textContent = estado.modoAoVivo ? `:${doisDigitos(partes.segundo)}` : '';
      elementos.horaSufixo.textContent = hora.sufixo;

      elementos.etiquetaDia.textContent = descreverDiferencaDeDias(diferenca);
      elementos.etiquetaDia.dataset.diferenca = diferenca === 0 ? 'igual' : (diferenca > 0 ? 'adiante' : 'atras');

      elementos.textoOffset.textContent = formatarOffset(obterOffsetMinutos(pais.fuso, estado.instanteUTC));
    }

    limparErro();
  } catch (erro) {
    console.error('[conversor] falha ao calcular os horários', erro);
    mostrarErro('Não foi possível calcular os horários neste dispositivo.');
  }
}

// ---------------------------------------------------------------------------
// Modo ao vivo
// ---------------------------------------------------------------------------

let idIntervalo = null;

/** Liga o tick de 1 segundo, se ainda não estiver ligado. */
function iniciarTick() {
  if (idIntervalo === null) {
    idIntervalo = setInterval(aoPassarSegundo, 1000);
  }
}

/** Desliga o tick. */
function pararTick() {
  if (idIntervalo !== null) {
    clearInterval(idIntervalo);
    idIntervalo = null;
  }
}

/** Executado a cada segundo enquanto o modo ao vivo está ativo. */
function aoPassarSegundo() {
  estado.instanteUTC = Date.now();
  renderizar();
}

/**
 * Liga ou desliga o modo ao vivo, ajustando o tick.
 * @param {boolean} ativo Verdadeiro para acompanhar o tempo real.
 */
function definirModoAoVivo(ativo) {
  estado.modoAoVivo = ativo;
  if (ativo) {
    estado.instanteUTC = Date.now();
    iniciarTick();
  } else {
    pararTick();
  }
  renderizar();
  salvarEstado();
}

// ---------------------------------------------------------------------------
// Eventos
// ---------------------------------------------------------------------------

/** Trata a edição da data ou da hora: sai do modo ao vivo e fixa o instante. */
function aoEditarCampos() {
  const textoData = campoData.value;
  const textoHora = campoHora.value;

  // Campo pela metade durante a digitação não é erro — só espera.
  if (!textoData || !textoHora) {
    return;
  }

  const [ano, mes, dia] = textoData.split('-').map(Number);
  const [hora, minuto] = textoHora.split(':').map(Number);

  if (![ano, mes, dia, hora, minuto].every(Number.isFinite)) {
    mostrarErro('Data ou hora inválida.');
    return;
  }

  estado.modoAoVivo = false;
  pararTick();
  estado.instanteUTC = converterLocalParaUTC(PAISES[estado.paisMestre].fuso, ano, mes, dia, hora, minuto);
  renderizar();
  salvarEstado();
}

/**
 * Troca o país de referência mantendo o mesmo instante no tempo — os campos
 * passam a mostrar esse instante na visão local do novo país mestre.
 */
function aoTrocarPaisMestre() {
  if (PAISES[seletorPais.value] === undefined) {
    return;
  }
  estado.paisMestre = seletorPais.value;
  reconstruirCards();
  renderizar();
  salvarEstado();
}

/**
 * Pausa o tick com a aba escondida e ressincroniza ao voltar. O Android congela
 * timers em segundo plano de forma imprevisível; sem isso o app reapareceria
 * mostrando um horário defasado.
 */
function aoMudarVisibilidade() {
  if (document.hidden) {
    pararTick();
  } else if (estado.modoAoVivo) {
    estado.instanteUTC = Date.now();
    renderizar();
    iniciarTick();
  }
}

// ---------------------------------------------------------------------------
// Inicialização
// ---------------------------------------------------------------------------

/** Verifica se o navegador sabe trabalhar com fusos IANA. */
function navegadorSuportaFusos() {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo' }).format(new Date());
    return true;
  } catch (erro) {
    console.error('[conversor] navegador sem suporte a fusos IANA', erro);
    return false;
  }
}

/** Registra o service worker (caminho relativo por causa do GitHub Pages). */
function registrarServiceWorker() {
  if (!('serviceWorker' in navigator)) {
    return;
  }
  navigator.serviceWorker.register('./service-worker.js').catch((erro) => {
    // Sem service worker o app ainda funciona online — não é erro fatal.
    console.warn('[conversor] service worker não registrado', erro);
  });
}

/** Ponto de entrada. */
function iniciar() {
  if (!navegadorSuportaFusos()) {
    mostrarErro('Este navegador não tem suporte a fusos horários. Atualize o Chrome e tente de novo.');
    return;
  }

  restaurarEstado();
  montarSeletor();
  reconstruirCards();

  seletorPais.addEventListener('change', aoTrocarPaisMestre);
  campoData.addEventListener('input', aoEditarCampos);
  campoHora.addEventListener('input', aoEditarCampos);
  botaoAgora.addEventListener('click', () => definirModoAoVivo(true));
  document.addEventListener('visibilitychange', aoMudarVisibilidade);

  if (estado.modoAoVivo) {
    estado.instanteUTC = Date.now();
    iniciarTick();
  }

  renderizar();
  registrarServiceWorker();
}

iniciar();
