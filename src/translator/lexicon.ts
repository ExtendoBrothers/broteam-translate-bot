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
  // ...add more languages as needed
};

export function detectLanguageByLexicon(text: string): string | null {
  // Filter words: ignore very short words (<=2 chars) as they're unreliable indicators
  // (e.g., "de", "l", "a", "i" exist in many languages)
  const words = text.toLowerCase().split(/\W+/).filter(w => w.length > 2);
  const totalWords = words.length;

  if (totalWords === 0) return null;

  let bestMatch: { lang: string; count: number; percentage: number } = { lang: '', count: 0, percentage: 0 };

  for (const [lang, lexicon] of Object.entries(LEXICONS)) {
    let matchCount = 0;
    for (const word of words) {
      if (lexicon.has(word)) matchCount++;
    }

    const percentage = (matchCount / totalWords) * 100;

    // Require at least 50% of words to match for confident detection
    if (percentage >= 50 && percentage > bestMatch.percentage) {
      bestMatch = { lang, count: matchCount, percentage };
    }
  }

  return bestMatch.percentage >= 50 ? bestMatch.lang : null;
}

/**
 * Get English lexicon match percentage for gibberish detection
 * Returns the percentage of words that exist in the English dictionary
 */
export function getEnglishMatchPercentage(text: string): number {
  const words = text.toLowerCase().split(/\W+/).filter(w => w.length > 2);
  if (words.length === 0) return 0;

  let matchCount = 0;
  for (const word of words) {
    if (LEXICONS.en.has(word)) matchCount++;
  }

  return (matchCount / words.length) * 100;
}
