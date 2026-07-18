import type { PrismaClient } from '../../src/generated/prisma/client';
import { tokenizePassage } from '../../src/lib/speed-reading';

const STARTER_TITLE = 'Why Spacing Strengthens Memory';
const STARTER_TEXT = `Students often assume that repeating the same material many times in one sitting is the fastest way to learn it. That method can create a strong feeling of familiarity, but familiarity is not the same as durable memory. When practice is concentrated into one block, the next repetition arrives while the previous one is still easy to recall.

The spacing effect describes the advantage of distributing study over time. A learner might review a fact today, return to it tomorrow, and revisit it several days later. Each successful retrieval requires more effort than the last immediate repetition. That effort helps strengthen access to the memory and provides evidence about what is actually becoming difficult.

Spacing works especially well when it is combined with retrieval practice. Instead of rereading an answer, the learner first tries to produce it from memory and then checks the result. A scheduler can lengthen the interval after a confident answer and shorten it after an error. The intervals should grow gradually rather than according to a rigid calendar that ignores performance.

The method is not a reason to delay every kind of practice. Closely grouped attempts can be useful while a skill is brand new, and difficult material may need shorter intervals. The central idea is to avoid treating a temporary sense of ease as proof of mastery. Durable learning is better measured by successful recall after some forgetting has had time to occur.`;

export async function ensureStarterSpeedReadingPassage(prisma: PrismaClient) {
  const existing = await prisma.speedReadingPassage.findFirst({
    where: { title: STARTER_TITLE, source: 'built-in' },
  });
  if (existing) return existing;
  return prisma.speedReadingPassage.create({
    data: {
      title: STARTER_TITLE,
      topic: 'The spacing effect and retrieval practice',
      category: 'learning science',
      difficulty: 'intermediate',
      sourceUrl: 'https://en.wikipedia.org/wiki/Spacing_effect',
      text: STARTER_TEXT,
      wordCount: tokenizePassage(STARTER_TEXT).length,
      questions: [
        { id: 'q1', prompt: 'Why can blocked repetition create a misleading sense of learning?', choices: ['It removes all feedback', 'The material remains temporarily familiar', 'It always uses difficult questions', 'The intervals become too long'] },
        { id: 'q2', prompt: 'What does the passage recommend combining with spacing?', choices: ['Passive rereading', 'Highlighting every sentence', 'Retrieval practice', 'A rigid calendar'] },
        { id: 'q3', prompt: 'How should a scheduler react to an error?', choices: ['Shorten the next interval', 'End the topic permanently', 'Double the interval', 'Ignore performance'] },
        { id: 'q4', prompt: 'What is the passage’s main standard for durable learning?', choices: ['Feeling fluent during one session', 'Completing many repetitions', 'Reading without pauses', 'Successful recall after some forgetting'] },
      ],
      answerKey: [
        { questionId: 'q1', correctIndex: 1, explanation: 'Immediate repetition stays easy because the previous exposure is still familiar.' },
        { questionId: 'q2', correctIndex: 2, explanation: 'The passage explicitly pairs spacing with attempting retrieval before checking.' },
        { questionId: 'q3', correctIndex: 0, explanation: 'Errors indicate that the next interval should be shorter.' },
        { questionId: 'q4', correctIndex: 3, explanation: 'The conclusion contrasts temporary ease with recall after time has passed.' },
      ],
      source: 'built-in',
    },
  });
}
