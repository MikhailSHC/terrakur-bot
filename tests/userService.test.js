const fs = require('fs');
const path = require('path');

jest.mock('../config', () => ({
  USER_DATA_FILE: '.jest-user-activity-test.json'
}));

const UserService = require('../services/userService');

const testDataPath = path.join(__dirname, '..', '.jest-user-activity-test.json');

describe('UserService activity stats', () => {
  let userService;

  beforeEach(() => {
    try {
      fs.unlinkSync(testDataPath);
    } catch {
      /* ignore */
    }
    userService = new UserService();
  });

  afterEach(() => {
    try {
      fs.unlinkSync(testDataPath);
    } catch {
      /* ignore */
    }
  });

  it('getLifetimeStatsByActivity sums only matching sessions', () => {
    const chatId = '999';
    userService.getUserSession(chatId);
    userService.addSession(chatId, {
      id: '1',
      distanceM: 1000,
      durationSec: 100,
      activityId: 'running',
      mode: 'free_run'
    });
    userService.addSession(chatId, {
      id: '2',
      distanceM: 500,
      durationSec: 50,
      activityId: 'walking',
      mode: 'free_run'
    });

    const run = userService.getLifetimeStatsByActivity(chatId, 'running');
    expect(run.totalDistanceM).toBe(1000);
    expect(run.totalSessions).toBe(1);

    const walk = userService.getLifetimeStatsByActivity(chatId, 'walking');
    expect(walk.totalDistanceM).toBe(500);
    expect(walk.totalSessions).toBe(1);
  });
});
