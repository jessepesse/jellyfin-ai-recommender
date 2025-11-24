// Test debug endpoint with username/password login
const axios = require('axios');
const readline = require('readline');

const API_URL = 'http://localhost:3001/api';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(prompt) {
  return new Promise((resolve) => {
    rl.question(prompt, resolve);
  });
}

async function testWithLogin() {
  console.log('🔐 Jellyfin Debug Test with Login\n');
  
  try {
    // Get credentials
    const username = await question('Enter Jellyfin username: ');
    const password = await question('Enter Jellyfin password: ');
    
    console.log('\n📤 Step 1: Logging in to Jellyfin...');
    
    // Login to get token
    const loginResponse = await axios.post(`${API_URL}/auth/login`, {
      username,
      password
    });
    
    if (!loginResponse.data.success) {
      console.error('❌ Login failed:', loginResponse.data.message);
      rl.close();
      return;
    }
    
    const accessToken = loginResponse.data.jellyfinAuth.AccessToken;
    const userId = loginResponse.data.jellyfinAuth.User.Id;
    const userName = loginResponse.data.jellyfinAuth.User.Name;
    
    console.log('✅ Login successful!');
    console.log('   User:', userName);
    console.log('   User ID:', userId);
    console.log('   Token:', `${accessToken.substring(0, 12)}...`);
    
    // Test debug endpoint
    console.log('\n📤 Step 2: Fetching watched history...');
    const debugResponse = await axios.get(`${API_URL}/debug/jellyfin`, {
      headers: {
        'x-access-token': accessToken,
        'x-user-id': userId,
        'x-jellyfin-url': 'none'
      }
    });
    
    console.log('\n✅ Response received:\n');
    console.log('Message:', debugResponse.data.message);
    console.log('Count:', debugResponse.data.count);
    
    if (debugResponse.data.items && debugResponse.data.items.length > 0) {
      console.log('\n📋 Watched Items:\n');
      debugResponse.data.items.forEach((item, index) => {
        console.log(`${index + 1}. ${item.Name} (${item.ProductionYear || 'N/A'})`);
        console.log(`   Type: ${item.Type}`);
        console.log(`   TMDB ID: ${item.ProviderIds?.Tmdb || '❌ NOT FOUND'}`);
        console.log(`   IMDB ID: ${item.ProviderIds?.Imdb || '❌ NOT FOUND'}`);
        console.log(`   Played: ${item.Played}`);
        console.log(`   Last Played: ${item.LastPlayedDate || 'N/A'}`);
        console.log(`   Genres: ${item.Genres?.join(', ') || 'None'}`);
        console.log(`   Rating: ${item.CommunityRating || 'N/A'}`);
        console.log('');
      });
      
      console.log('🔑 Key Findings:');
      const withTmdb = debugResponse.data.items.filter(i => i.ProviderIds?.Tmdb).length;
      const withImdb = debugResponse.data.items.filter(i => i.ProviderIds?.Imdb).length;
      console.log(`   Items with TMDB ID: ${withTmdb}/${debugResponse.data.items.length}`);
      console.log(`   Items with IMDB ID: ${withImdb}/${debugResponse.data.items.length}`);
      
      if (withTmdb === 0) {
        console.log('\n⚠️  WARNING: No TMDB IDs found!');
        console.log('   The recommendation system needs TMDB IDs to verify items.');
        console.log('   Make sure your Jellyfin library has proper metadata.');
      }
    } else {
      console.log('\n⚠️  No watched items returned');
      console.log('\nPossible reasons:');
      console.log('   1. You haven\'t watched any movies/series in Jellyfin yet');
      console.log('   2. Items are not marked as "Played" in Jellyfin');
      console.log('   3. The Jellyfin library is empty');
      
      console.log('\n💡 To fix:');
      console.log('   1. Watch a movie or episode in Jellyfin');
      console.log('   2. Or manually mark items as "Played" in Jellyfin UI');
      console.log('   3. Then run this script again');
    }
    
  } catch (err) {
    console.error('\n❌ Error:', err.response?.data?.message || err.message);
    if (err.response?.status === 401) {
      console.log('\n💡 Authentication failed. Check your username and password.');
    } else if (err.response) {
      console.error('Status:', err.response.status);
      console.error('Data:', JSON.stringify(err.response.data, null, 2));
    }
  } finally {
    rl.close();
  }
}

testWithLogin();
