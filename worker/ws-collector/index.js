export default {
  async fetch(request, env) {
    // CORS
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST',
          'Access-Control-Allow-Headers': 'Content-Type',
        }
      });
    }

    if (request.method !== 'POST') {
      return new Response('OK', {
        headers: { 'Access-Control-Allow-Origin': '*' }
      });
    }

    try {
      const data = await request.json();
      
      // 推送到 Mac Redis
      await fetch(env.REDIS_URL + '/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });

      return new Response('OK', {
        headers: { 'Access-Control-Allow-Origin': '*' }
      });
    } catch (e) {
      return new Response('Error: ' + e.message, {
        status: 500,
        headers: { 'Access-Control-Allow-Origin': '*' }
      });
    }
  }
}
