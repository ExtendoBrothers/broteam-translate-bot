// src/translator/lexicon.ts
// Simple language lexicon for dictionary-based language detection
// Add more words for each language as needed

// Dynamically load the large English lexicon from JSON
import englishWords from './english-lexicon.json';

export const LEXICONS: Record<string, Set<string>> = {
  en: new Set(englishWords),
  ja: new Set(['これ', 'それ', 'あれ', 'この', 'その', 'あの', 'ここ', 'そこ', 'あそこ', '私', 'あなた', '彼', '彼女', '私たち', 'あなたたち', '彼ら', '何', '誰', 'どこ', 'いつ', 'どう', 'なぜ', 'です', 'ます', 'いる', 'ある', 'する', 'なる', 'できる', '行く', '来る', '見る', '言う', '思う', '知る', '食べる', '飲む', '買う', '使う', '作る', '読む', '書く', '話す', '聞く', '立つ', '座る', '歩く', '走る', '持つ', '待つ', '始める', '終わる', '分かる', '好き', '嫌い', '大きい', '小さい', '新しい', '古い', '良い', '悪い', '高い', '安い', '多い', '少ない', '早い', '遅い', '暑い', '寒い', '面白い', '楽しい', '難しい', '簡単']),
  ru: new Set(['и', 'в', 'не', 'он', 'на', 'я', 'что', 'тот', 'быть', 'с', 'а', 'по', 'это', 'она', 'как', 'к', 'у', 'из', 'за', 'от', 'но', 'же', 'вы', 'так', 'о', 'мы', 'вы', 'они', 'этот', 'который', 'мочь', 'человек', 'один', 'ещё', 'бы', 'такой', 'только', 'себя', 'свой', 'какой', 'когда', 'уже', 'для', 'вот', 'кто', 'да', 'говорить', 'год', 'знать', 'до', 'или', 'если', 'время', 'рука', 'нет', 'самый', 'ни', 'стать', 'большой', 'даже', 'другой', 'наш', 'мой', 'жизнь', 'первый', 'два', 'день', 'её', 'новый', 'под', 'где', 'дело', 'есть', 'сам', 'раз', 'там', 'чем', 'глаз', 'тут', 'сейчас', 'можно', 'после', 'его', 'надо', 'без', 'видеть', 'идти', 'работа', 'три', 'слово', 'место', 'лицо', 'потом', 'делать', 'ничто', 'тоже', 'сказать', 'потому', 'чтобы', 'всегда', 'между', 'понимать', 'друг', 'сидеть', 'жить', 'должен', 'чуть', 'сразу', 'куда', 'почему', 'спросить', 'ответить', 'думать', 'иметь', 'бить', 'стоять', 'смотреть', 'ребёнок', 'нужно', 'мир', 'земля', 'конечно', 'женщина', 'ребенок', 'голова', 'дом', 'случай', 'начать', 'деньги', 'вода', 'отец', 'машина', 'дверь', 'работать', 'писать', 'любить', 'старый', 'новый', 'маленький', 'большой', 'длинный', 'короткий', 'высокий', 'низкий', 'толстый', 'тонкий', 'сильный', 'слабый', 'тяжёлый', 'лёгкий', 'тёмный', 'светлый', 'горячий', 'холодный', 'быстрый', 'медленный', 'интересный', 'скучный', 'весёлый', 'грустный', 'трудный', 'лёгкий', 'простой', 'сложный']),
  es: new Set(['que', 'de', 'no', 'un', 'ser', 'la', 'los', 'el', 'una', 'por', 'con', 'para', 'una', 'su', 'al', 'lo', 'como', 'más', 'pero', 'sus', 'le', 'ya', 'fue', 'este', 'también', 'hasta', 'hay', 'donde', 'han', 'porque', 'muy', 'sin', 'sobre', 'ser', 'tiene', 'hace', 'cuando', 'entre', 'está', 'durante', 'todo', 'algunos', 'ellos', 'uno', 'dos', 'tres', 'año', 'años', 'tiempo', 'puede', 'pueden', 'debe', 'deben', 'hace', 'hacer', 'tiene', 'tener', 'está', 'estar', 'estado', 'sido', 'sea', 'vida', 'vez', 'cada', 'día', 'tiene', 'lugar', 'parte', 'caso', 'mismo', 'otro', 'todos', 'estas', 'toda', 'tanto', 'menos', 'gran', 'años', 'ahora', 'siempre', 'mucho', 'poco', 'después', 'entonces', 'casi', 'así', 'hombre', 'ella', 'allí', 'nada', 'todo', 'hacer', 'algo', 'ver', 'dar', 'aquí', 'hoy', 'bueno', 'mejor', 'nuevo', 'grande', 'pequeño', 'largo', 'corto', 'alto', 'bajo', 'fuerte', 'débil', 'diferente', 'igual', 'importante', 'difícil', 'fácil', 'posible', 'imposible', 'necesario', 'suficiente', 'seguro', 'cierto', 'verdad', 'nombre', 'casa', 'país', 'mundo', 'ciudad', 'pueblo', 'hombre', 'mujer', 'niño', 'niña', 'padre', 'madre', 'hijo', 'hija', 'amigo', 'familia', 'agua', 'comida', 'trabajo', 'escuela', 'noche', 'mañana', 'tarde', 'semana', 'mes', 'hora', 'momento', 'primero', 'último', 'solo', 'solamente', 'nunca', 'siempre', 'otra', 'otros', 'muchos', 'muchas', 'algunas', 'varios', 'varias', 'todo', 'nada', 'algo', 'alguien', 'nadie', 'ninguno', 'ninguna', 'cualquier', 'cualquiera', 'cada', 'ambos', 'ambas', 'propio', 'propia', 'mismo', 'misma', 'tanto', 'tanta', 'tantos', 'tantas', 'poco', 'poca', 'pocos', 'pocas', 'demasiado', 'demasiada', 'bastante', 'suficiente']),
  pt: new Set(['que', 'de', 'não', 'um', 'ser', 'para', 'com', 'uma', 'por', 'os', 'as', 'dos', 'das', 'como', 'mais', 'mas', 'já', 'até', 'pela', 'pelo', 'também', 'quando', 'muito', 'nos', 'mesmo', 'ainda', 'sem', 'outro', 'onde', 'bem', 'ano', 'anos', 'vez', 'fazer', 'pode', 'dia', 'dois', 'três', 'suas', 'foi', 'ele', 'ela', 'você', 'nós', 'eles', 'elas', 'tem', 'ter', 'esse', 'essa', 'isso', 'este', 'esta', 'isto', 'aquele', 'aquela', 'aquilo', 'meu', 'minha', 'seu', 'sua', 'nosso', 'nossa', 'deles', 'delas', 'todo', 'toda', 'todos', 'todas', 'outro', 'outra', 'alguns', 'algumas', 'muito', 'muita', 'muitos', 'muitas', 'pouco', 'pouca', 'poucos', 'poucas', 'qualquer', 'cada', 'tudo', 'nada', 'algo', 'alguém', 'ninguém', 'nenhum', 'algum', 'alguma', 'mesma', 'próprio', 'própria', 'tal', 'qual', 'quais', 'quanto', 'quanta', 'tantos', 'tantas', 'tanto', 'tanta', 'menos', 'mais', 'melhor', 'pior', 'maior', 'menor', 'grande', 'pequeno', 'longo', 'curto', 'alto', 'baixo', 'forte', 'fraco', 'bom', 'mau', 'novo', 'velho', 'jovem', 'igual', 'diferente', 'mesmo', 'verdade', 'verdadeiro', 'falso', 'certo', 'errado', 'possível', 'impossível', 'fácil', 'difícil', 'importante', 'necessário', 'suficiente', 'vida', 'morte', 'tempo', 'momento', 'lugar', 'casa', 'país', 'mundo', 'cidade', 'homem', 'mulher', 'criança', 'pai', 'mãe', 'filho', 'filha', 'amigo', 'família', 'água', 'comida', 'trabalho', 'escola', 'noite', 'manhã', 'tarde', 'semana', 'hora', 'primeiro', 'última', 'só', 'somente', 'nunca', 'sempre', 'ainda', 'agora', 'hoje', 'ontem', 'amanhã', 'logo', 'depois', 'antes', 'durante', 'desde', 'enquanto', 'embora', 'portanto', 'porém', 'contudo', 'entretanto', 'todavia']),
  fr: new Set(['que', 'de', 'le', 'la', 'les', 'un', 'une', 'des', 'et', 'est', 'être', 'avoir', 'pour', 'dans', 'ce', 'il', 'qui', 'ne', 'sur', 'se', 'pas', 'plus', 'pouvoir', 'par', 'je', 'avec', 'tout', 'faire', 'son', 'mettre', 'autre', 'on', 'mais', 'nous', 'comme', 'ou', 'si', 'leur', 'ans', 'très', 'dire', 'elle', 'là', 'où', 'cette', 'lui', 'bien', 'deux', 'même', 'prendre', 'mon', 'celui', 'toute', 'grand', 'homme', 'aussi', 'année', 'après', 'dont', 'notre', 'sans', 'sous', 'peut', 'encore', 'tous', 'jour', 'ses', 'contre', 'temps', 'depuis', 'même', 'entre', 'beaucoup', 'peu', 'moins', 'mieux', 'meilleur', 'pire', 'bon', 'mauvais', 'nouveau', 'vieux', 'jeune', 'grand', 'petit', 'long', 'court', 'haut', 'bas', 'fort', 'faible', 'vrai', 'faux', 'premier', 'dernier', 'seul', 'seulement', 'jamais', 'toujours', 'quelque', 'plusieurs', 'chaque', 'tout', 'rien', 'quelque', 'quelqu', 'personne', 'aucun', 'aucune', 'certains', 'certaines', 'tel', 'telle', 'tels', 'telles', 'quel', 'quelle', 'quels', 'quelles', 'lequel', 'laquelle', 'lesquels', 'lesquelles', 'autre', 'autres', 'même', 'mêmes', 'tel', 'pareil', 'différent', 'différente', 'égal', 'égale', 'semblable', 'possible', 'impossible', 'facile', 'difficile', 'important', 'importante', 'nécessaire', 'suffisant', 'suffisante', 'vie', 'mort', 'temps', 'moment', 'lieu', 'endroit', 'place', 'maison', 'pays', 'monde', 'ville', 'rue', 'homme', 'femme', 'enfant', 'père', 'mère', 'fils', 'fille', 'ami', 'amie', 'famille', 'eau', 'nourriture', 'travail', 'école', 'nuit', 'matin', 'soir', 'après-midi', 'semaine', 'mois', 'heure', 'aujourd', 'hier', 'demain', 'maintenant', 'alors', 'donc', 'ensuite', 'puis', 'encore', 'déjà', 'toujours', 'jamais', 'souvent', 'parfois', 'rarement', 'pendant', 'durant', 'avant', 'après', 'depuis', 'jusque', 'parce', 'car', 'comme', 'puisque', 'quand', 'lorsque', 'tandis', 'pendant', 'alors', 'donc', 'ainsi', 'aussi', 'mais', 'pourtant', 'cependant', 'toutefois', 'néanmoins']),
  // Irish Gaelic (ga) - Common words to prevent false English classification
  ga: new Set(['agus', 'tá', 'bhí', 'nach', 'leis', 'níl', 'sé', 'sí', 'sin', 'mar', 'le', 'go', 'aon', 'ach', 'ní', 'orm', 'mé', 'tú', 'é', 'í', 'muid', 'sibh', 'iad', 'mise', 'tusa', 'eisean', 'ise', 'muide', 'sibhse', 'iadsan', 'féin', 'cé', 'cad', 'conas', 'cén', 'céard', 'cathain', 'cá', 'cár', 'cén', 'fáth', 'an', 'na', 'ar', 'as', 'dá', 'de', 'do', 'faoi', 'i', 'ó', 'ón', 'roimh', 'thar', 'trí', 'um', 'chun', 'ag', 'ann', 'anseo', 'ansin', 'ansiúd', 'suas', 'síos', 'aníos', 'anuas', 'amach', 'isteach', 'thart', 'timpeall', 'tríd', 'bí', 'bíonn', 'beir', 'clois', 'cluin', 'déan', 'faigh', 'feic', 'ith', 'ól', 'suigh', 'seas', 'téigh', 'tar', 'abair', 'aimsigh', 'athraigh', 'bailigh', 'bain', 'beannacht', 'bris', 'buail', 'caith', 'ceangail', 'ceap', 'ceannaigh', 'ceart', 'codail', 'coinnigh', 'coistigh', 'comhair', 'creid', 'críochnaigh', 'cuir', 'cuimhnigh', 'cuidigh', 'cuir', 'dean', 'diúltaigh', 'díol', 'dúisigh', 'éirigh', 'éist', 'fág', 'fan', 'fás', 'feach', 'fógair', 'freagair', 'glan', 'glaoigh', 'imir', 'impigh', 'inis', 'íoc', 'labhair', 'léigh', 'léim', 'lig', 'mair', 'mol', 'mothaigh', 'múin', 'oibrigh', 'oscail', 'pléigh', 'pós', 'rith', 'roghnaigh', 'ruaig', 'sábháil', 'samhlaigh', 'scríobh', 'scéal', 'seol', 'smaoinigh', 'snámh', 'socraigh', 'soláthair', 'spéis', 'stop', 'tabhair', 'tairg', 'taispeáin', 'teastaigh', 'tóg', 'tosaigh', 'tuig', 'tuill', 'ullamhaigh', 'úsáid', 'bean', 'fear', 'buachaill', 'cailín', 'duine', 'daoine', 'páiste', 'leanbh', 'mac', 'iníon', 'athair', 'máthair', 'uncail', 'aintín', 'deirfiúr', 'deartháir', 'cara', 'clann', 'teaghlach', 'mór', 'beag', 'fada', 'gearr', 'ard', 'íseal', 'láidir', 'lag', 'trom', 'éadrom', 'deas', 'álainn', 'grána', 'maidin', 'tráthnóna', 'oíche', 'inniu', 'inné', 'amárach', 'anois', 'ansin', 'riamh', 'choíche', 'i', 'gcónaí', 'uaireanta', 'corruair', 'minic', 'lá', 'seachtain', 'mí', 'bliain', 'uair', 'ceann', 'dhá', 'trí', 'ceithre', 'cúig', 'sé', 'seacht', 'ocht', 'naoi', 'deich', 'céad', 'míle', 'teach', 'tír', 'cathair', 'baile', 'sráid', 'bóthar', 'rud', 'áit', 'domhan', 'talamh', 'spéir', 'loch', 'abhainn', 'farraige', 'uisce', 'bia', 'béile', 'deoch', 'airgead', 'obair', 'scoil', 'foirgneamh', 'carr', 'rothar', 'bus', 'traein', 'eitleán', 'cosán', 'cúl', 'tosaigh', 'lár', 'taobh', 'aoibh', 'gháire', 'airteagal', 'feached', 'feacadh', 'alt', 'nua', 'sean', 'óg', 'deas', 'olc', 'maith', 'dona', 'saor', 'daor', 'fuar', 'te', 'bog', 'crua', 'deas', 'greannmhar', 'leadránach', 'tábhachtach', 'éasca', 'deacair']),
  // ...add more languages as needed
};

export function detectLanguageByLexicon(text: string): string | null {
  // Filter words: ignore very short words (<=2 chars) as they're unreliable indicators
  // Strip @mentions and #hashtags - they aren't real words in any language and skew detection
  const words = text.replace(/@[a-zA-Z0-9_-]+/g, '').replace(/#[a-zA-Z0-9_]+/g, '').toLowerCase().split(/\W+/).filter(w => w.length > 2);
  const totalWords = words.length;

  if (totalWords === 0) return null;

  // ── Foreign languages get priority ──────────────────────────────────────
  // Check non-English lexicons first. If any language scores ≥50%, return it
  // immediately. A false rejection (good English classified as foreign) is
  // acceptable because the caller retries; a false acceptance (non-English
  // posted as output) is not. Picking the best-scoring foreign match avoids
  // ambiguity when multiple foreign sets overlap.
  let bestForeign: { lang: string; percentage: number } = { lang: '', percentage: 0 };
  for (const [lang, lexicon] of Object.entries(LEXICONS)) {
    if (lang === 'en') continue;
    let matchCount = 0;
    for (const word of words) {
      if (lexicon.has(word)) matchCount++;
    }
    const percentage = (matchCount / totalWords) * 100;
    if (percentage >= 50 && percentage > bestForeign.percentage) {
      bestForeign = { lang, percentage };
    }
  }
  if (bestForeign.percentage >= 50) return bestForeign.lang;

  // ── English fallback ─────────────────────────────────────────────────────
  // No foreign language qualified — check English so callers can confirm the
  // result really is English before accepting it.
  let enCount = 0;
  for (const word of words) {
    if (LEXICONS.en.has(word)) enCount++;
  }
  if ((enCount / totalWords) * 100 >= 50) return 'en';

  return null;
}

/**
 * Get English lexicon match percentage for gibberish detection
 * Returns the percentage of words that exist in the English dictionary
 */
export function getEnglishMatchPercentage(text: string): number {
  // Strip @mentions and #hashtags - they aren't real words in any language and skew detection
  const words = text.replace(/@[a-zA-Z0-9_-]+/g, '').replace(/#[a-zA-Z0-9_]+/g, '').toLowerCase().split(/\W+/).filter(w => w.length > 2);
  if (words.length === 0) return 0;

  let matchCount = 0;
  for (const word of words) {
    if (LEXICONS.en.has(word)) matchCount++;
  }

  return (matchCount / words.length) * 100;
}
