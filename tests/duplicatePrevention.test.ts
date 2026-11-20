jest.mock('../src/utils/logger', () => ({ logger: { info: jest.fn(), error: jest.fn() } }));
jest.mock('../src/utils/tweetTracker', () => ({ tweetTracker: { markProcessed: jest.fn() } }));
jest.mock('../src/utils/postTracker', () => ({ postTracker: { recordPost: jest.fn() } }));
jest.mock('../src/utils/tweetQueue', () => ({ tweetQueue: {} }));
jest.mock('../src/utils/contentDeduplication', () => ({ logPostedContent: jest.fn() }));
jest.mock('../src/utils/translationStability', () => ({}));
jest.mock('../src/utils/enhancedInstanceLock', () => ({}));

import { recordSuccessfulPost } from '../src/utils/duplicatePrevention';
import { tweetTracker } from '../src/utils/tweetTracker';
import { postTracker } from '../src/utils/postTracker';
import { logPostedContent } from '../src/utils/contentDeduplication';

it('records confirmed content without counting an already-counted attempt twice', () => {
  recordSuccessfulPost('tweet', 'translation', false);
  expect(tweetTracker.markProcessed).toHaveBeenCalledWith('tweet');
  expect(logPostedContent).toHaveBeenCalledWith('tweet', 'translation');
  expect(postTracker.recordPost).not.toHaveBeenCalled();

  recordSuccessfulPost('next', 'other');
  expect(postTracker.recordPost).toHaveBeenCalledTimes(1);
});
