// Test the Jellyfin sync endpoint
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

async function testSync() {
  console.log('🔄 Testing Jellyfin Watch History Sync\n');
  
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
    
    // Get current database stats
    console.log('\n📤 Step 2: Checking current database...');
    const watchlistBefore = await axios.get(`${API_URL}/user/watchlist`, {
      headers: {
        'x-access-token': accessToken,
        'x-user-id': userId,
        'x-user-name': userName,
        'x-jellyfin-url': 'none'
      }
    });
    
    const watchedBefore = watchlistBefore.data.filter(item => item.status === 'WATCHED').length;
    console.log(`   Current watched items in DB: ${watchedBefore}`);
    
    // Trigger sync
    console.log('\n📤 Step 3: Triggering sync (this may take a while)...');
    const startTime = Date.now();
    
    const syncResponse = await axios.post(`${API_URL}/sync/jellyfin`, {}, {
      headers: {
        'x-access-token': accessToken,
        'x-user-id': userId,
        'x-user-name': userName,
        'x-jellyfin-url': 'none'
      }
    });
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    
    console.log(`\n✅ Sync completed in ${duration}s`);
    console.log('\n📊 Sync Results:');
    console.log(`   Total watched items found: ${syncResponse.data.total}`);
    console.log(`   New items synced: ${syncResponse.data.new}`);
    console.log(`   Already in database: ${syncResponse.data.skipped}`);
    console.log(`   Failed: ${syncResponse.data.failed}`);
    
    if (syncResponse.data.errors && syncResponse.data.errors.length > 0) {
      console.log('\n⚠️  Errors:');
      syncResponse.data.errors.slice(0, 5).forEach(err => {
        console.log(`   - ${err}`);
      });
      if (syncResponse.data.errors.length > 5) {
        console.log(`   ... and ${syncResponse.data.errors.length - 5} more`);
      }
    }
    
    // Get updated database stats
    console.log('\n📤 Step 4: Verifying database update...');
    const watchlistAfter = await axios.get(`${API_URL}/user/watchlist`, {
      headers: {
        'x-access-token': accessToken,
        'x-user-id': userId,
        'x-user-name': userName,
        'x-jellyfin-url': 'none'
      }
    });
    
    const watchedAfter = watchlistAfter.data.filter(item => item.status === 'WATCHED').length;
    console.log(`   Watched items in DB now: ${watchedAfter}`);
    console.log(`   Increase: +${watchedAfter - watchedBefore}`);
    
    // Show sample of synced items
    console.log('\n📋 Sample of synced items:');
    const watchedItems = watchlistAfter.data
      .filter(item => item.status === 'WATCHED')
      .slice(0, 5);
    
    watchedItems.forEach((item, i) => {
      console.log(`   ${i + 1}. ${item.title} (${item.releaseYear}) - TMDB: ${item.tmdbId}`);
      if (item.posterUrl) {
        console.log(`      ✓ Has poster`);
      }
      if (item.overview) {
        console.log(`      ✓ Has overview: ${item.overview.substring(0, 50)}...`);
      }
    });
    
    console.log('\n✅ Sync test complete!');
    
  } catch (err) {
    console.error('\n❌ Error:', err.response?.data || err.message);
    if (err.response?.data?.errors) {
      console.log('\nSync errors:');
      err.response.data.errors.forEach(e => console.log(`  - ${e}`));
    }
  } finally {
    rl.close();
  }
}

testSync();
