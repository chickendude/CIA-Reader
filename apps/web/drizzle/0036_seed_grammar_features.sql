-- Seed `grammar_features` with Universal-Dependencies feature labels.
--
-- These are the keys/values Stanza emits onto Hindi/Marathi/Odia tokens
-- and that paradigm slots write onto generated `lemma_forms.features`
-- blobs. The popup looks each (key, value) up in this table to render
-- compact pills with hover tooltips. `pos_scope` filters which POSes
-- the row applies to; `[]` means "all POSes". `sort_order` clusters
-- pills by category in the popup (polarity → tense → aspect → … →
-- definiteness).

INSERT INTO "grammar_features" ("feat_key", "feat_value", "pos_scope", "short_label", "long_label", "sort_order") VALUES
  -- Polarity (verbs + particles)
  ('Polarity', 'Neg', ARRAY['VERB','PART'], 'neg', 'negative', 10),
  ('Polarity', 'Pos', ARRAY['VERB','PART'], 'pos', 'positive', 11),

  -- Tense (verbs)
  ('Tense', 'Past', ARRAY['VERB'], 'past', 'past tense', 20),
  ('Tense', 'Pres', ARRAY['VERB'], 'pres', 'present tense', 21),
  ('Tense', 'Fut',  ARRAY['VERB'], 'fut',  'future tense', 22),

  -- Aspect (verbs)
  ('Aspect', 'Hab',  ARRAY['VERB'], 'hab',    'habitual aspect',   30),
  ('Aspect', 'Imp',  ARRAY['VERB'], 'imperf', 'imperfective aspect', 31),
  ('Aspect', 'Perf', ARRAY['VERB'], 'perf',   'perfective aspect',  32),
  ('Aspect', 'Prog', ARRAY['VERB'], 'prog',   'progressive aspect', 33),

  -- Mood (verbs)
  ('Mood', 'Ind', ARRAY['VERB'], 'ind',    'indicative mood',  40),
  ('Mood', 'Imp', ARRAY['VERB'], 'imper',  'imperative mood',  41),
  ('Mood', 'Sub', ARRAY['VERB'], 'subj',   'subjunctive mood', 42),
  ('Mood', 'Cnd', ARRAY['VERB'], 'cond',   'conditional mood', 43),

  -- VerbForm (verbs)
  ('VerbForm', 'Fin',  ARRAY['VERB'], 'fin',  'finite verb',     50),
  ('VerbForm', 'Inf',  ARRAY['VERB'], 'inf',  'infinitive',      51),
  ('VerbForm', 'Part', ARRAY['VERB'], 'part', 'participle',      52),
  ('VerbForm', 'Conv', ARRAY['VERB'], 'conv', 'converb',         53),
  ('VerbForm', 'Ger',  ARRAY['VERB'], 'ger',  'gerund',          54),

  -- Voice (verbs)
  ('Voice', 'Act',  ARRAY['VERB'], 'act',  'active voice',  60),
  ('Voice', 'Pass', ARRAY['VERB'], 'pass', 'passive voice', 61),
  ('Voice', 'Mid',  ARRAY['VERB'], 'mid',  'middle voice',  62),

  -- Person (verbs + pronouns)
  ('Person', '1', ARRAY['VERB','PRON'], '1', 'first person',  70),
  ('Person', '2', ARRAY['VERB','PRON'], '2', 'second person', 71),
  ('Person', '3', ARRAY['VERB','PRON'], '3', 'third person',  72),

  -- Number (most inflecting POSes)
  ('Number', 'Sing', ARRAY['NOUN','VERB','ADJ','PRON','DET'], 'sg', 'singular', 80),
  ('Number', 'Plur', ARRAY['NOUN','VERB','ADJ','PRON','DET'], 'pl', 'plural',   81),

  -- Gender (most inflecting POSes; not present in Odia/Bengali but kept for hi/mr)
  ('Gender', 'Masc', ARRAY['NOUN','VERB','ADJ','PRON','DET'], 'm', 'masculine', 90),
  ('Gender', 'Fem',  ARRAY['NOUN','VERB','ADJ','PRON','DET'], 'f', 'feminine',  91),
  ('Gender', 'Neut', ARRAY['NOUN','VERB','ADJ','PRON','DET'], 'n', 'neuter',    92),

  -- Case (nouns / pronouns / adjectives)
  ('Case', 'Nom', ARRAY['NOUN','PRON','ADJ'], 'nom', 'nominative case',   100),
  ('Case', 'Acc', ARRAY['NOUN','PRON','ADJ'], 'acc', 'accusative case',   101),
  ('Case', 'Gen', ARRAY['NOUN','PRON','ADJ'], 'gen', 'genitive case',     102),
  ('Case', 'Dat', ARRAY['NOUN','PRON','ADJ'], 'dat', 'dative case',       103),
  ('Case', 'Loc', ARRAY['NOUN','PRON','ADJ'], 'loc', 'locative case',     104),
  ('Case', 'Abl', ARRAY['NOUN','PRON','ADJ'], 'abl', 'ablative case',     105),
  ('Case', 'Ins', ARRAY['NOUN','PRON','ADJ'], 'ins', 'instrumental case', 106),
  ('Case', 'Voc', ARRAY['NOUN','PRON','ADJ'], 'voc', 'vocative case',     107),

  -- Definite (determiners; thin in Indo-Aryan but Stanza emits it)
  ('Definite', 'Def', ARRAY['DET'], 'def',   'definite',   110),
  ('Definite', 'Ind', ARRAY['DET'], 'indef', 'indefinite', 111),

  -- PronType (pronouns)
  ('PronType', 'Prs', ARRAY['PRON'], 'pers',   'personal pronoun',      120),
  ('PronType', 'Dem', ARRAY['PRON'], 'dem',    'demonstrative pronoun', 121),
  ('PronType', 'Int', ARRAY['PRON'], 'interr', 'interrogative pronoun', 122),
  ('PronType', 'Rel', ARRAY['PRON'], 'rel',    'relative pronoun',      123),
  ('PronType', 'Ind', ARRAY['PRON'], 'indef',  'indefinite pronoun',    124),
  ('PronType', 'Tot', ARRAY['PRON'], 'tot',    'total pronoun',         125),

  -- NumType (numerals + determiners)
  ('NumType', 'Card', ARRAY['NUM','DET'], 'card', 'cardinal',     130),
  ('NumType', 'Ord',  ARRAY['NUM','DET'], 'ord',  'ordinal',      131),
  ('NumType', 'Mult', ARRAY['NUM','DET'], 'mult', 'multiplicative', 132),

  -- Politeness (verbs + pronouns)
  ('Politeness', 'Form', ARRAY['VERB','PRON'], 'formal',   'formal',   140),
  ('Politeness', 'Infm', ARRAY['VERB','PRON'], 'informal', 'informal', 141);
