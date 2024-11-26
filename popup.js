const OPEN_API = process.env.OPENAI_API_KEY; // Set this securely

document.addEventListener('DOMContentLoaded', () => {
  console.log('Document loaded');
  checkAuthStatus();
});

document.getElementById('sign-in-btn').addEventListener('click', () => {
  console.log('Sign in button clicked');
  forceSignIn();
});

document.getElementById('sign-out-btn').addEventListener('click', () => {
  console.log('Sign out button clicked');
  signOut();
});

document.getElementById('sort-btn').addEventListener('click', () => {
  console.log('Sort by Priority button clicked');
  chrome.storage.local.get('authToken', (result) => {
    if (result.authToken) {
      console.log('Auth token found:', result.authToken);
      setLoading(true); // Show spinner immediately
      fetchEmails(result.authToken).then(emails => {
        sortEmailsByPriority(emails).then(sortedEmails => {
          saveEmailsToStorage(sortedEmails);
          displayEmails(sortedEmails);
          setLoading(false); // Hide spinner after displaying emails
        }).catch(err => {
          console.error('Error sorting emails:', err);
          setLoading(false); // Hide spinner on error
        });
      }).catch(err => {
        console.error('Error fetching emails:', err);
        setLoading(false); // Hide spinner on error
      });
    } else {
      console.log('No auth token found');
    }
  });
});

function setLoading(loading) {
  const spinner = document.getElementById('spinner');
  if (loading) {
      spinner.style.display = 'inline-block';
  } else {
      spinner.style.display = 'none';
  }
}

function checkAuthStatus() {
  console.log('Checking authentication status');
  chrome.storage.local.get('authToken', (result) => {
    if (result.authToken) {
      console.log('User is signed in');
      document.getElementById('sign-in-btn').style.display = 'none';
      document.getElementById('sign-out-btn').style.display = 'inline-block';
      document.getElementById('sort-btn').style.display = 'inline-block';
      loadEmailsFromStorage();
    } else {
      console.log('User is not signed in');
      document.getElementById('sign-in-btn').style.display = 'inline-block';
      document.getElementById('sign-out-btn').style.display = 'none';
      document.getElementById('sort-btn').style.display = 'none';
      document.getElementById('email-list').innerHTML = ''; // Clear email list
    }
  });
}

function forceSignIn() {
  console.log('Forcing sign in');
  // Clear all cached tokens before getting a new one
  chrome.identity.clearAllCachedAuthTokens(() => {
    console.log('All cached tokens cleared');
    // Remove all previous auth tokens
    chrome.identity.getAuthToken({ interactive: true }, (initialToken) => {
      if (chrome.runtime.lastError) {
        console.error('OAuth Error:', chrome.runtime.lastError.message);
        return;
      }
      console.log('Initial token obtained:', initialToken);
      chrome.identity.removeCachedAuthToken({ token: initialToken }, () => {
        console.log('Cached token removed:', initialToken);
        chrome.identity.getAuthToken({ interactive: true }, (newToken) => {
          if (chrome.runtime.lastError) {
            console.error('OAuth Error:', chrome.runtime.lastError.message);
            return;
          }
          console.log('New token obtained:', newToken);
          chrome.storage.local.set({ authToken: newToken }, () => {
            console.log('New token stored:', newToken);
            checkAuthStatus();
          });
        });
      });
    });
  });
}

function signOut() {
  console.log('Signing out');
  chrome.storage.local.get('authToken', (result) => {
    if (result.authToken) {
      revokeToken(result.authToken).then(() => {
        console.log('Token revoked');
        chrome.identity.clearAllCachedAuthTokens(() => {
          console.log('All cached tokens cleared');
          chrome.storage.local.remove('authToken', () => {
            console.log('Auth token removed from storage');
            clearStoredEmails();
            checkAuthStatus();
          });
        });
      }).catch((error) => {
        console.error('Error revoking token:', error);
        // Proceed with clearing tokens even if revocation fails
        chrome.identity.clearAllCachedAuthTokens(() => {
          console.log('All cached tokens cleared');
          chrome.storage.local.remove('authToken', () => {
            console.log('Auth token removed from storage');
            clearStoredEmails();
            checkAuthStatus();
          });
        });
      });
    } else {
      console.log('No auth token found');
      chrome.identity.clearAllCachedAuthTokens(() => {
        console.log('All cached tokens cleared');
        chrome.storage.local.remove('authToken', () => {
          console.log('Auth token removed from storage');
          clearStoredEmails();
          checkAuthStatus();
        });
      });
    }
  });
}

function revokeToken(token) {
  return fetch('https://accounts.google.com/o/oauth2/revoke', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: `token=${token}`
  });
}

async function fetchEmails(token) {
  console.log('Fetching emails with token:', token);
  try {
    const response = await fetch('https://www.googleapis.com/gmail/v1/users/me/messages?q=is:important is:unread&maxResults=15', {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    const data = await response.json();
    if (!data.messages) {
      throw new Error('No messages found');
    }
    console.log('Emails fetched:', data);
    return Promise.all(data.messages.map(async message => {
      const messageResponse = await fetch(`https://www.googleapis.com/gmail/v1/users/me/messages/${message.id}`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      return await messageResponse.json();
    }));
  } catch (error) {
    console.error('Error fetching emails:', error);
    throw error;
  }
}

async function markEmailAsRead(token, emailId) {
  console.log('Marking email as read:', emailId);
  try {
    await fetch(`https://www.googleapis.com/gmail/v1/users/me/messages/${emailId}/modify`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        removeLabelIds: ['UNREAD']
      })
    });
  } catch (error) {
    console.error('Error marking email as read:', error);
    throw error;
  }
}

async function sortEmailsByPriority(emails) {
  console.log('Sorting emails:', emails);
  const messages = [
    {
      role: "system",
      content: "You are an AI email assistant. Rank the following emails by priority based on general sentiment analysis, considering the body of the message, the email of the sender, and the subject. Focus on importance and urgency. YOU MUST NOT SAY ANYTHING ELSE OTHER THAN A LIST OF 15 INTEGERS BETWEEN 1 and 15 inclusive that tell you the ranking order of the emails in order of importance. Do not say any context at all."
    },
    {
      role: "user",
      content: emails.map((email, index) => `Email ${index + 1}:\nSubject: ${email.payload.headers.find(header => header.name === 'Subject').value}\nBody: ${email.snippet}`).join('\n\n')
    }
  ];

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': OPEN_API, // Replace with your actual API key
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'gpt-3.5-turbo',
      messages: messages,
      max_tokens: 500,
      temperature: 0
    })
  });

  const data = await response.json();
  console.log('Response from OpenAI API:', data);

  if (data.error) {
    throw new Error(data.error.message);
  }

  const sortedEmailsOrder = data.choices[0].message.content.trim().split(',').map(num => parseInt(num.trim(), 10));
  console.log('Sorted emails order:', sortedEmailsOrder);

  const sortedEmails = sortedEmailsOrder.map(index => emails[index - 1]);
  return sortedEmails;
}

function displayEmails(emails) {
  console.log('Displaying emails:', emails);
  const emailList = document.getElementById('email-list');
  emailList.innerHTML = '';
  emails.forEach((email, index) => {
    const emailElement = document.createElement('div');
    emailElement.className = 'email-item';
    emailElement.innerHTML = `
      <h3>${email.payload.headers.find(header => header.name === 'Subject').value}</h3>
      <p>${email.snippet}</p>
      <button class="read-btn">Read</button>
    `;
    emailElement.querySelector('.read-btn').addEventListener('click', async () => {
      chrome.storage.local.get('authToken', async (result) => {
        if (result.authToken) {
          await markEmailAsRead(result.authToken, email.id);
          emails.splice(index, 1);
          saveEmailsToStorage(emails);
          displayEmails(emails);
        }
      });
    });
    emailList.appendChild(emailElement);
  });
}

function saveEmailsToStorage(emails) {
  console.log('Saving emails to storage');
  chrome.storage.local.set({ savedEmails: emails }, () => {
    console.log('Emails saved to storage');
  });
}

function loadEmailsFromStorage() {
  console.log('Loading emails from storage');
  chrome.storage.local.get(['savedEmails'], (result) => {
    if (result.savedEmails) {
      console.log('Loaded emails from storage:', result.savedEmails);
      displayEmails(result.savedEmails);
    }
  });
}

function clearStoredEmails() {
  console.log('Clearing stored emails');
  chrome.storage.local.remove('emails');
  emailList.innerHTML = '';
}