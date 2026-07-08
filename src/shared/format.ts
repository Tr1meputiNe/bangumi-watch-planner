export function displaySubjectName(name: string, nameCn: string): string {
  return nameCn || name;
}

export function displayEpisodeTitle(name: string, nameCn: string, sort: number): string {
  const title = nameCn || name;
  return title || `第 ${sort} 集`;
}

export function formatDateTime(value: string | null): string {
  if (!value) return '尚未同步';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Shanghai'
  }).format(date);
}
