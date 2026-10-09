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
            // Minimal rendering of ClaimResolutionResponse (src/api/types.ts); richer UI is Ticket 7.2.
            const d = data.decision || {};
            const c = d.citations || {};
            resultDiv.textContent = [
                `Status: ${data.status}`,
                `Decision: ${d.decision} (confidence ${d.confidence_score}/100)`,
                `Reasoning: ${d.reasoning}`,
                `Cited policy: ${c.policy_number || c.policy_id || 'none'}; coverage rules: ${(c.coverage_rule_ids || []).join(', ') || 'none'}`,
                `Agent summary: ${data.summary}`,
            ].join('\n');
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
