document.getElementById('claimForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const claimId = document.getElementById('claim_id').value;
    const authToken = document.getElementById('auth_token').value;
    const resultDiv = document.getElementById('result');
    const errorDiv = document.getElementById('error');
    
    resultDiv.style.display = 'none';
    errorDiv.style.display = 'none';
    
    const headers = {
        'Content-Type': 'application/json'
    };
    
    if (authToken) {
        headers['Authorization'] = authToken;
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
