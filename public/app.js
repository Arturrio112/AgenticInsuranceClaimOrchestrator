document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;
    const loginErrorDiv = document.getElementById('loginError');
    
    loginErrorDiv.style.display = 'none';
    
    try {
        const response = await fetch('/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ username, password })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            localStorage.setItem('authToken', data.token);
            document.getElementById('loginSection').style.display = 'none';
            document.getElementById('claimSection').style.display = 'block';
        } else {
            loginErrorDiv.textContent = data.error || 'Login failed';
            loginErrorDiv.style.display = 'block';
        }
    } catch (err) {
        loginErrorDiv.textContent = 'Failed to connect to the server.';
        loginErrorDiv.style.display = 'block';
    }
});

document.getElementById('claimForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const claimId = document.getElementById('claim_id').value;
    const resultDiv = document.getElementById('result');
    const errorDiv = document.getElementById('error');
    
    resultDiv.style.display = 'none';
    errorDiv.style.display = 'none';
    
    const authToken = localStorage.getItem('authToken');
    const headers = {
        'Content-Type': 'application/json'
    };
    
    if (authToken) {
        headers['Authorization'] = `Bearer ${authToken}`;
    }
    
    try {
        const response = await fetch('/claim', {
            method: 'POST',
            headers: headers,
            body: JSON.stringify({ claim_id: claimId })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            resultDiv.textContent = typeof data.content === 'string' ? data.content : JSON.stringify(data.content);
            resultDiv.style.display = 'block';
        } else {
            errorDiv.textContent = data.error || 'An error occurred';
            errorDiv.style.display = 'block';
        }
    } catch (err) {
        errorDiv.textContent = 'Failed to connect to the server.';
        errorDiv.style.display = 'block';
    }
});
