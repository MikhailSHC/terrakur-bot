function formatMeta(meta = {}) {
  const entries = Object.entries(meta).filter(([, value]) => value !== undefined);
  if (!entries.length) return '';
  return entries.map(([key, value]) => `${key}=${JSON.stringify(value)}`).join(' ');
}

function createLogger(scope = 'app', baseMeta = {}) {
  const write = (level, message, meta = {}) => {
    const ts = new Date().toISOString();
    const mergedMeta = { ...baseMeta, ...meta };
    const tail = formatMeta(mergedMeta);
    const line = `[${ts}] [${level}] [${scope}] ${message}${tail ? ` ${tail}` : ''}`;
    if (level === 'ERROR') {
      console.error(line);
      return;
    }
    if (level === 'WARN') {
      console.warn(line);
      return;
    }
    console.log(line);
  };

  return {
    info(message, meta) {
      write('INFO', message, meta);
    },
    warn(message, meta) {
      write('WARN', message, meta);
    },
    error(message, meta) {
      write('ERROR', message, meta);
    },
    child(childScope, childMeta = {}) {
      return createLogger(`${scope}:${childScope}`, { ...baseMeta, ...childMeta });
    }
  };
}

module.exports = {
  createLogger
};
