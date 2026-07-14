import { useCallback, useEffect, useMemo, useState } from 'react';
import type { HTMLAttributes } from 'react';

export interface TypewriterLineProps
  extends Omit<HTMLAttributes<HTMLParagraphElement>, 'children'> {
  rotationInterval?: number;
  sentences: readonly string[];
  typingInterval?: number;
}

interface SentenceDeck {
  current: string;
  remaining: string[];
}

type AnimationPhase = 'typing' | 'holding' | 'deleting';

const reducedMotionQuery = '(prefers-reduced-motion: reduce)';

function normalizeDelay(value: number, fallback: number) {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function normalizeSentences(sentences: readonly string[]) {
  return [...new Set(sentences.map((sentence) => sentence.trim()).filter(Boolean))];
}

function shuffleSentences(sentences: readonly string[], previous?: string) {
  const shuffled = [...sentences];

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [
      shuffled[swapIndex] as string,
      shuffled[index] as string,
    ];
  }

  if (shuffled.length > 1 && shuffled[0] === previous) {
    [shuffled[0], shuffled[1]] = [
      shuffled[1] as string,
      shuffled[0] as string,
    ];
  }

  return shuffled;
}

function createDeck(sentences: readonly string[], previous?: string): SentenceDeck {
  const shuffled = shuffleSentences(sentences, previous);

  return {
    current: shuffled[0] ?? '',
    remaining: shuffled.slice(1),
  };
}

function usePrefersReducedMotion() {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(() =>
    typeof window === 'undefined'
      ? false
      : window.matchMedia(reducedMotionQuery).matches,
  );

  useEffect(() => {
    const mediaQuery = window.matchMedia(reducedMotionQuery);
    const updatePreference = () => setPrefersReducedMotion(mediaQuery.matches);

    updatePreference();
    mediaQuery.addEventListener('change', updatePreference);

    return () => mediaQuery.removeEventListener('change', updatePreference);
  }, []);

  return prefersReducedMotion;
}

interface TypewriterContentProps
  extends Omit<TypewriterLineProps, 'sentences'> {
  sentences: readonly string[];
}

function TypewriterContent({
  className,
  rotationInterval = 8_000,
  sentences,
  typingInterval = 40,
  ...paragraphProps
}: TypewriterContentProps) {
  const [deck, setDeck] = useState(() => createDeck(sentences));
  const prefersReducedMotion = usePrefersReducedMotion();
  const characters = useMemo(() => Array.from(deck.current), [deck]);
  const [visibleCharacterCount, setVisibleCharacterCount] = useState(() =>
    prefersReducedMotion ? characters.length : 0,
  );
  const [phase, setPhase] = useState<AnimationPhase>(() =>
    prefersReducedMotion ? 'holding' : 'typing',
  );
  const safeRotationInterval = normalizeDelay(rotationInterval, 8_000);
  const safeTypingInterval = normalizeDelay(typingInterval, 40);
  const classes = ['ds-typewriter-line', className].filter(Boolean).join(' ');

  const advanceDeck = useCallback(() => {
    setDeck((previousDeck) =>
      previousDeck.remaining.length === 0
        ? createDeck(sentences, previousDeck.current)
        : {
            current: previousDeck.remaining[0] as string,
            remaining: previousDeck.remaining.slice(1),
          },
    );
  }, [sentences]);

  useEffect(() => {
    if (prefersReducedMotion) {
      setVisibleCharacterCount(characters.length);
      setPhase('holding');

      if (sentences.length <= 1) return;

      const timeoutId = window.setTimeout(advanceDeck, safeRotationInterval);
      return () => window.clearTimeout(timeoutId);
    }

    if (phase === 'typing') {
      if (visibleCharacterCount < characters.length) {
        const timeoutId = window.setTimeout(
          () => setVisibleCharacterCount((count) => count + 1),
          safeTypingInterval,
        );
        return () => window.clearTimeout(timeoutId);
      }

      setPhase('holding');
      return;
    }

    if (phase === 'holding') {
      if (sentences.length <= 1) return;

      const timeoutId = window.setTimeout(
        () => setPhase('deleting'),
        safeRotationInterval,
      );
      return () => window.clearTimeout(timeoutId);
    }

    if (visibleCharacterCount > 0) {
      const timeoutId = window.setTimeout(
        () => setVisibleCharacterCount((count) => count - 1),
        safeTypingInterval,
      );
      return () => window.clearTimeout(timeoutId);
    }

    advanceDeck();
    setPhase('typing');
  }, [
    advanceDeck,
    characters.length,
    phase,
    prefersReducedMotion,
    safeRotationInterval,
    safeTypingInterval,
    sentences.length,
    visibleCharacterCount,
  ]);

  useEffect(() => {
    setVisibleCharacterCount(prefersReducedMotion ? characters.length : 0);
    setPhase(prefersReducedMotion ? 'holding' : 'typing');
  }, [characters, prefersReducedMotion]);

  return (
    <p
      {...paragraphProps}
      className={classes}
      data-reduced-motion={prefersReducedMotion || undefined}
    >
      <span aria-hidden="true" className="ds-typewriter-line__visible">
        {characters.slice(0, visibleCharacterCount).join('')}
      </span>
      <span className="ds-visually-hidden sr-only">
        {deck.current}
      </span>
    </p>
  );
}

/** A shuffled, decorative working line whose rotation is independent of work. */
export function TypewriterLine({
  sentences,
  ...typewriterProps
}: TypewriterLineProps) {
  const sentenceSignature = JSON.stringify(normalizeSentences(sentences));
  const normalizedSentences = useMemo(
    () => JSON.parse(sentenceSignature) as string[],
    [sentenceSignature],
  );

  return (
    <TypewriterContent
      {...typewriterProps}
      key={sentenceSignature}
      sentences={normalizedSentences}
    />
  );
}
