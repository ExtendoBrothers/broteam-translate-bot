const { predictHumor } = require('./dist/src/utils/humorOnnx');

async function test() {
  try {
    console.log('Testing humor prediction...');
    const result = await predictHumor('This is a funny joke');
    console.log('Result:', result);
  } catch (error) {
    console.error('Error:', error);
  }
}

test();