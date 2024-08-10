# File Processor

This project processes text files to extract and structure data using OpenAI's API, and then stores the processed data in Firebase Firestore. It also sends email notifications about the processing status using SendGrid.

## Table of Contents

- [Installation](#installation)
- [Configuration](#configuration)
- [Usage](#usage)
- [File Structure](#file-structure)
- [Contributing](#contributing)
- [License](#license)

## Installation

1. **Clone the repository:**

    ```bash
    git clone https://github.com/yourusername/file-processor.git
    cd file-processor
    ```

2. **Install dependencies:**

    ```bash
    npm install
    ```

3. **Set up environment variables:**

    Create a `.env` file in the root directory and add the following environment variables:

    ```env
    OPENAI_API_KEY=your_openai_api_key
    SENDGRID_API_KEY=your_sendgrid_api_key
    FIREBASE_CONFIG=your_firebase_config_json
    MAILER_FROM_OPTION=your_email@example.com
    ```

## Configuration

- **OpenAI API**: Used for processing text data.
- **SendGrid**: Used for sending email notifications.
- **Firebase Firestore**: Used for storing processed data.

## Usage

1. **Start the application:**

    ```bash
    node fileProcessor.js
    ```

2. **Trigger the processing event:**

    The processing is triggered by emitting the `process` event on the `event` emitter with the required parameters:

    ```javascript
    event.emit('process', data, filePath, title);
    ```

    - `data`: The content of the file to be processed.
    - `filePath`: The path to the file being processed.
    - `title`: The title for the group of processed data.

## File Structure

- `fileProcessor.js`: Main file that handles file processing, data extraction, and storage.
- `dataProcessor.js`: Contains the `groupAndSortPhones` function for grouping and sorting the processed data.
- `cleaner.js`: Contains the `convertString` function for cleaning the data if necessary.

## Contributing

1. **Fork the repository.**
2. **Create a new branch:**

    ```bash
    git checkout -b feature-branch
    ```

3. **Make your changes and commit them:**

    ```bash
    git commit -m 'Add some feature'
    ```

4. **Push to the branch:**

    ```bash
    git push origin feature-branch
    ```

5. **Create a pull request.**

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.