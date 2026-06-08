# Troubleshooting Guide

This guide provides solutions to common issues you might encounter while using Code-Police.

## Common Issues

### 1. Webhooks Not Firing

**Problem**: Webhooks configured for your repository are not triggering as expected.

**Possible Causes**:
*   **Incorrect Webhook URL**: The URL provided for the webhook might be incorrect or inaccessible.
*   **Secret Mismatch**: If a webhook secret is configured, it might not match the secret used by Code-Police.
*   **Insufficient Permissions**: The GitHub App or user setting up the webhook might not have the necessary permissions.
*   **Network Issues**: Firewalls or network configurations might be blocking outgoing requests from GitHub or incoming requests to your Code-Police instance.
*   **GitHub Service Issues**: Occasionally, GitHub's webhook delivery service might experience delays or outages.

**Solutions**:
*   **Verify Webhook URL**: Double-check the webhook URL in your repository settings. Ensure it's publicly accessible if your Code-Police instance is hosted externally.
*   **Check Secret**: If you're using a webhook secret, ensure it's identical in both GitHub and your Code-Police configuration.
*   **Review Permissions**: Ensure the GitHub App or user has `Read & Write` access to `Repository contents` and `Webhooks`.
*   **Inspect GitHub Delivery History**: Go to your repository settings on GitHub, navigate to "Webhooks", and check the "Recent Deliveries" section for detailed logs and error messages. This can often pinpoint the exact issue.
*   **Check Server Logs**: Examine the logs of your Code-Police instance for any incoming webhook requests or errors during processing.

### 2. Key Decryption Failures (BYOK - Bring Your Own Key)

**Problem**: You are experiencing errors related to decrypting keys, especially when using the Bring Your Own Key (BYOK) feature.

**Possible Causes**:
*   **Incorrect `BYOK_ENCRYPTION_KEY`**: The `BYOK_ENCRYPTION_KEY` environment variable in your `.env.local` file might be incorrect or missing.
*   **Corrupted Encrypted Keys**: The stored encrypted keys might have been corrupted.
*   **Mismatched Encryption Algorithm**: The encryption algorithm used to encrypt the keys might not match the decryption algorithm in Code-Police.
*   **Missing Dependencies**: Necessary cryptographic libraries might be missing or incorrectly installed.

**Solutions**:
*   **Verify `BYOK_ENCRYPTION_KEY`**: Ensure that the `BYOK_ENCRYPTION_KEY` in your `.env.local` file is exactly the same as the one used during key encryption. This key is crucial for both encryption and decryption.
*   **Regenerate Keys**: If you suspect corruption, try regenerating and re-encrypting your keys with the correct `BYOK_ENCRYPTION_KEY`.
*   **Check `byok.ts`**: If you have modified `src/lib/agents/code-police/byok.ts`, ensure that the encryption and decryption logic is sound and matches.
*   **Review Environment Setup**: Confirm that all required environment variables for BYOK are correctly set.
*   **Examine Logs**: Look for error messages in your Code-Police instance logs that specifically mention decryption failures or cryptographic errors.

### 3. `npm install` or Dependency Issues

**Problem**: `npm install` fails or you encounter issues with project dependencies.

**Possible Causes**:
*   **Node.js/npm Version Mismatch**: Your Node.js or npm version might be incompatible with the project's requirements.
*   **Corrupted npm Cache**: A corrupted npm cache can lead to installation failures.
*   **Network Restrictions**: Firewalls or proxy settings might prevent npm from downloading packages.
*   **Missing Build Tools**: Some packages require native compilation, which might fail if build tools (like Python, Visual C++ Build Tools on Windows) are not installed.

**Solutions**:
*   **Check Node.js and npm Versions**: Refer to the `package.json` or `CONTRIBUTING.md` for recommended Node.js and npm versions. Use a tool like `nvm` (Node Version Manager) to manage multiple Node.js versions.
*   **Clear npm Cache**: Run `npm cache clean --force` to clear your npm cache, then try `npm install` again.
*   **Check Network/Proxy Settings**: If you are behind a corporate proxy, configure npm to use it:
    ```bash
    npm config set proxy http://yourproxy.com:8080
    npm config set https-proxy http://yourproxy.com:8080
    ```
*   **Install Build Tools**: For Windows, install "Desktop development with C++" from Visual Studio Installer. For Linux, install `build-essential`.

## General Troubleshooting Steps

1.  **Check Logs**: Always start by checking the application logs for any error messages or warnings.
2.  **Review Configuration**: Ensure all environment variables and configuration files (`.env.local`, etc.) are correctly set up.
3.  **Restart Services**: Sometimes, simply restarting the Code-Police application or related services can resolve transient issues.
4.  **Consult Documentation**: Refer to the official Code-Police documentation for specific setup instructions or known issues.
5.  **Search Existing Issues**: Check the project's issue tracker on GitHub for similar problems and their solutions.
6.  **Seek Community Support**: If you can't find a solution, consider opening a new issue on GitHub or reaching out to the community for help.
