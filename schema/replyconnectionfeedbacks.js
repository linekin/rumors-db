export default {
  _all: { enabled: false },
  properties: {
    score: { type: 'byte' }, // 1, 0, -1
    userId: { type: 'keyword' },

    // The user submits the feedback with which client.
    // Should be one of backend APP ID, 'BOT_LEGACY', 'RUMORS_LINE_BOT' or 'WEBSITE'
    from: { type: 'keyword' },
    comment: { type: 'text', analyzer: 'cjk' },
    createdAt: { type: 'date' },
    updatedAt: { type: 'date' },
  },
};
