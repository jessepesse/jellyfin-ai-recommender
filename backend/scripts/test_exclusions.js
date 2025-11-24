// Test that watched items are properly excluded from recommendations
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

async function testExclusions() {
  console.log('🔍 Testing Watched Items Exclusion\n');
  
  try {
    const username = await question('Enter Jellyfin username: ');
    const password = await question('Enter Jellyfin password: ');
    
    console.log('\n📤 Step 1: Logging in...');
    const loginResponse = await axios.post(`${API_URL}/auth/login`, {
      username,
      password
    });
    
    if (!loginResponse.data.success) {
      console.error('❌ Login failed');
      rl.close();
      return;
    }
    
    const accessToken = loginResponse.data.jellyfinAuth.AccessToken;
    const userId = loginResponse.data.jellyfinAuth.User.Id;
    const userName = loginResponse.data.jellyfinAuth.User.Name;
    
    console.log('✅ Login successful:', userName);
    
    // Get watched history
    console.log('\n📤 Step 2: Fetching watched history...');
    const historyResponse = await axios.get(`${API_URL}/debug/jellyfin`, {
      headers: {
        'x-access-token': accessToken,
        'x-user-id': userId,
        'x-user-name': userName,
        'x-jellyfin-url': 'none'
      }
    });
    
    const watchedItems = historyResponse.data.items || [];
    const watchedTmdbIds = watchedItems.map(i => i.ProviderIds?.Tmdb).filter(Boolean);
    
    console.log(`   Found ${watchedItems.length} watched items`);
    console.log(`   TMDB IDs: ${watchedTmdbIds.slice(0, 5).join(', ')}${watchedTmdbIds.length > 5 ? '...' : ''}`);
    
    // Get recommendations
    console.log('\n📤 Step 3: Fetching recommendations...');
    const recsResponse = await axios.get(`${API_URL}/recommendations`, {
      headers: {
        'x-access-token': accessToken,
        'x-user-id': userId,
        'x-user-name': userName,
        'x-jellyfin-url': 'none'
      },
      params: {
        type: 'movie'
      }
    });
    
    const recommendations = recsResponse.data || [];
    console.log(`   Received ${recommendations.length} recommendations`);
    
    // Check if any recommendations match watched items
    console.log('\n🔍 Checking for duplicates...');
    const recTmdbIds = recommendations.map(r => r.tmdbId).filter(Boolean);
    const duplicates = recTmdbIds.filter(id => watchedTmdbIds.includes(id));
    
    if (duplicates.length > 0) {
      console.log(`\n❌ FAIL: Found ${duplicates.length} recommendations you've already watched!`);
      console.log('   Duplicate TMDB IDs:', duplicates);
      
      duplicates.forEach(dupId => {
        const watched = watchedItems.find(w => w.ProviderIds?.Tmdb === dupId);
        const rec = recommendations.find(r => r.tmdbId === dupId);
        console.log(`   - ${watched?.Name} (TMDB: ${dupId}) was recommended as "${rec?.title}"`);
      });
    } else {
      console.log('\n✅ SUCCESS: No watched items in recommendations!');
      console.log('   The exclusion logic is working correctly.');
    }
    
    console.log('\n📋 Sample Recommendations:');
    recommendations.slice(0, 5).forEach((rec, i) => {
      console.log(`   ${i + 1}. ${rec.title} (${rec.releaseYear}) - TMDB: ${rec.tmdbId}`);
    });
    
    console.log('\n📊 Statistics:');
    console.log(`   Watched items: ${watchedItems.length}`);
    console.log(`   Watched TMDB IDs: ${watchedTmdbIds.length}`);
    console.log(`   Recommendations: ${recommendations.length}`);
    console.log(`   Duplicates: ${duplicates.length}`);
    
  } catch (err) {
    console.error('\n❌ Error:', err.response?.data || err.message);
  } finally {
    rl.close();
  }
}

testExclusions();
