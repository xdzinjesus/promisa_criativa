// Perguntas do briefing de site. Usado pelo servidor (validação), pela página pública
// e pelo painel (que mostra as respostas). Texto em português, sem alterar.
export const BRIEFING_TITLE = 'Briefing de Site | Promisa Criativa';
export const BRIEFING_INTRO = 'Responda a estas 10 perguntas para que a Promisa Criativa desenvolva uma demonstração personalizada do site da sua empresa. Leva cerca de 5 minutos. Não é necessário ter logo, fotos ou textos prontos. Usaremos as informações fornecidas para elaborar a prévia e entrar em contato sobre o projeto. A demonstração não implica contratação.';

// type: 'text' (caixa de texto), 'checkbox' (várias opções + "Outro"), 'radio' (uma opção).
export const BRIEFING_QUESTIONS = Object.freeze([
  { id: 'q1', type: 'text', required: true, label: 'Qual é o nome da sua empresa e em qual segmento ela atua?' },
  { id: 'q2', type: 'text', required: true, label: 'Quais são os principais produtos ou serviços oferecidos pela sua empresa?' },
  { id: 'q3', type: 'checkbox', required: true, other: true, label: 'Quem é o público-alvo da sua empresa?', options: ['Consumidores em geral', 'Outras empresas', 'Famílias', 'Jovens', 'Profissionais de um segmento específico', 'Clientes de Concórdia e região', 'Clientes de todo o Brasil'] },
  { id: 'q4', type: 'text', required: true, label: 'O que diferencia sua empresa dos concorrentes?' },
  { id: 'q5', type: 'checkbox', required: true, other: true, label: 'Qual é o principal objetivo do seu futuro site?', options: ['Atrair novos clientes', 'Receber pedidos de orçamento', 'Aumentar os contatos pelo WhatsApp', 'Apresentar produtos e serviços', 'Permitir agendamentos', 'Fortalecer a imagem e a credibilidade da empresa', 'Vender produtos pela internet'] },
  { id: 'q6', type: 'checkbox', required: true, other: true, label: 'Quais funcionalidades ou seções você gostaria de encontrar no site?', options: ['Apresentação da empresa', 'Catálogo de produtos', 'Serviços com descrições detalhadas', 'Galeria de fotos', 'Botão de contato pelo WhatsApp', 'Formulário para solicitar orçamento', 'Sistema de agendamento', 'Avaliações e depoimentos de clientes', 'Localização integrada ao Google Maps', 'Perguntas frequentes', 'Links para redes sociais'] },
  { id: 'q7', type: 'radio', required: true, label: 'Qual estilo visual combina mais com a sua empresa?', options: ['Moderno e minimalista', 'Elegante e sofisticado', 'Tecnológico e futurista', 'Criativo e descontraído', 'Tradicional e profissional', 'Luxuoso e exclusivo', 'Não tenho preferência. Gostaria de sugestões.'] },
  { id: 'q8', type: 'text', required: true, label: 'Sua empresa possui logo, cores oficiais, fotografias ou outros materiais para o site?', help: 'Se tiver, compartilhe links para logotipo, fotos, catálogo ou Instagram. Também pode informar que enviará os arquivos pelo WhatsApp. Se ainda não possuir materiais, tudo bem.' },
  { id: 'q9', type: 'text', required: true, label: 'Quais contatos, redes sociais, endereço e horários de funcionamento devem aparecer no site?', help: 'Informe o WhatsApp comercial, Instagram e demais redes sociais, e-mail, endereço completo, cidade e horário de atendimento. Se algum dado não deve aparecer, basta omitir.' },
  { id: 'q10', type: 'text', required: false, label: 'Existe algum site de referência ou algo específico que você gostaria de incluir na demonstração?', help: 'Você pode enviar links de sites que considera bonitos, contar quais cores prefere ou quais estilos não quer. Se não tiver referências, nós sugeriremos uma identidade visual para seu segmento.' }
]);

export const BRIEFING_LIMITS = Object.freeze({ text: 3000, other: 300 });

// Remove caracteres de controle (mantém quebra de linha e tabulação em textos longos).
export function cleanText(value, { multiline = true } = {}) {
  // Também remove controles de direção do texto (U+202A–202E, U+2066–2069), que podem
  // disfarçar o conteúdo no painel, e normaliza separadores de linha Unicode.
  const text = String(value ?? '').replace(/\r\n?|[\u2028\u2029]/g, '\n')
    .replace(multiline ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069\ufeff]/g : /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069\ufeff]/g, '');
  return text.trim();
}

// Confere UMA resposta. Devolve { ok:true, value } ou { ok:false, error }.
export function validateAnswer(question, index, value) {
  const number = index + 1, fail = error => ({ ok: false, error });
  if (question.type === 'text') {
    if (value === undefined || value === null || value === '') return question.required ? fail(`Responda a pergunta ${number}.`) : { ok: true, value: '' };
    if (typeof value !== 'string') return fail(`Resposta inválida na pergunta ${number}.`);
    if (value.length > BRIEFING_LIMITS.text * 2) return fail(`A resposta da pergunta ${number} está muito longa.`);
    const text = cleanText(value);
    if (text.length > BRIEFING_LIMITS.text) return fail(`A resposta da pergunta ${number} está muito longa (máximo ${BRIEFING_LIMITS.text} caracteres).`);
    if (!text && question.required) return fail(`Responda a pergunta ${number}.`);
    return { ok: true, value: text };
  }
  const empty = value === undefined || value === null;
  if (!empty && (typeof value !== 'object' || Array.isArray(value))) return fail(`Resposta inválida na pergunta ${number}.`);
  const selected = empty ? [] : value.selected ?? [];
  if (!Array.isArray(selected) || selected.length > question.options.length) return fail(`Resposta inválida na pergunta ${number}.`);
  for (const option of selected) if (typeof option !== 'string' || !question.options.includes(option)) return fail(`Opção inválida na pergunta ${number}.`);
  if (new Set(selected).size !== selected.length) return fail(`Resposta inválida na pergunta ${number}.`);
  if (question.type === 'radio' && selected.length > 1) return fail(`Escolha apenas uma opção na pergunta ${number}.`);
  const otherRaw = empty ? '' : value.other ?? '';
  if (typeof otherRaw !== 'string') return fail(`Resposta inválida na pergunta ${number}.`);
  if (otherRaw && !question.other) return fail(`Resposta inválida na pergunta ${number}.`);
  const other = cleanText(otherRaw, { multiline: false });
  if (other.length > BRIEFING_LIMITS.other) return fail(`O campo “Outro” da pergunta ${number} está muito longo (máximo ${BRIEFING_LIMITS.other} caracteres).`);
  if (question.required && !selected.length && !other) return fail(question.type === 'radio' ? `Escolha uma opção na pergunta ${number}.` : `Escolha pelo menos uma opção na pergunta ${number}.`);
  return { ok: true, value: { selected: [...selected], other } };
}

// Confere o conjunto de respostas. Devolve { ok, answers } ou { ok:false, error, field }.
export function validateAnswers(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'Respostas inválidas.' };
  const known = new Set(BRIEFING_QUESTIONS.map(question => question.id));
  for (const key of Object.keys(raw)) if (!known.has(key)) return { ok: false, error: 'Respostas inválidas.' };
  const answers = {};
  for (const [index, question] of BRIEFING_QUESTIONS.entries()) {
    const result = validateAnswer(question, index, raw[question.id]);
    if (!result.ok) return { ok: false, error: result.error, field: question.id };
    answers[question.id] = result.value;
  }
  return { ok: true, answers };
}

// Versão em texto simples (para copiar e colar).
export function answersToText(answers, title = '') {
  const lines = title ? [title, ''] : [];
  BRIEFING_QUESTIONS.forEach((question, index) => {
    const value = answers?.[question.id];
    let text;
    if (typeof value === 'string') text = value;
    else text = [...(value?.selected || []), ...(value?.other ? ['Outro: ' + value.other] : [])].join('; ');
    lines.push(`${index + 1}. ${question.label}`, text || '(sem resposta)', '');
  });
  return lines.join('\n').trimEnd();
}
