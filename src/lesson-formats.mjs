import { executableIds } from './engine.mjs';
export const lessonFormats = [
  ['all', '全部内容'], ['experiment', '可推演实验'], ['diagram', '专用图解'], ['flow', '流程概览'],
];
export const lessonFormat = (lesson) => executableIds.includes(lesson.id) ? 'experiment' : lesson.kind === 'flow' ? 'flow' : 'diagram';
export const matchesLessonFormat = (lesson, format) => format === 'all' || lessonFormat(lesson) === format;
