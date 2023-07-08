import * as core from '@actions/core';
import * as github from '@actions/github';

async function run(): Promise<void> {
  core.info('it works');
  try {
    const myToken = core.getInput('my-token');

    // const branchName = core.getInput('branch-name');

    const octokit = github.getOctokit(myToken).rest;

    try {
      try {
        await octokit.repos.getContent({
          owner: 'google',
          repo: 'libphonenumber',
          path: 'resources/PhoneNumberMetadata.xml',
        });

        core.info('metadata is successful');
      } catch (error: any) {
        core.setFailed(`Error: ${error.message}`);
      }

      const { owner, repo } = github.context.repo;

      const baseBranch = 'main'; // The base branch you want to create the new branch from
      const newBranch = 'new-branch'; // The name of the new branch you want to create
      const filePath = 'file.txt'; // The path to the file you want to modify

      // Step 1: Get the existing file content
      const fileContent = (
        await octokit.repos.getContent({
          owner,
          repo,
          path: filePath,
        })
      ).data;

      if (!('content' in fileContent)) {
        return;
      }

      const existingContent = Buffer.from(
        fileContent.content,
        'base64',
      ).toString('utf8');

      // Step 2: Compare existing content with new content
      const newContent = 'New content'; // Replace with your desired content

      core.info(existingContent);

      core.info(newContent);

      if (existingContent === newContent) {
        core.info(
          'Content is identical. Skipping commit and pull request creation.',
        );
        return;
      }

      // Step 3: Create a new branch
      await octokit.git.createRef({
        owner,
        repo,
        ref: `refs/heads/${newBranch}`,
        sha: (
          await octokit.repos.getBranch({ owner, repo, branch: baseBranch })
        ).data.commit.sha,
      });

      core.info('ref created');

      // Step 4: Modify the file
      const updatedContent = Buffer.from(newContent, 'utf8').toString('base64');

      await octokit.repos.createOrUpdateFileContents({
        owner,
        repo,
        path: filePath,
        message: 'Update file',
        content: updatedContent,
        sha: fileContent.sha,
        branch: newBranch,
      });

      core.info('file updated');

      // Step 5: Create a new commit
      const commitMessage = 'Commit changes';
      await octokit.git.createCommit({
        owner,
        repo,
        message: commitMessage,
        tree: (
          await octokit.repos.getBranch({ owner, repo, branch: newBranch })
        ).data.commit.commit.tree.sha,
        parents: [
          (await octokit.repos.getBranch({ owner, repo, branch: newBranch }))
            .data.commit.sha,
        ],
      });

      core.info('comitted');

      // Step 6: Create a pull request
      const pullRequestTitle = 'New Pull Request';
      const pullRequestBody = 'This is a new pull request';
      const pullRequest = await octokit.pulls.create({
        owner,
        repo,
        title: pullRequestTitle,
        body: pullRequestBody,
        head: newBranch,
        base: baseBranch,
      });

      core.info(`Pull request created: ${pullRequest.data.html_url}`);
    } catch (error: any) {
      core.setFailed(`Error: ${error.message}`);
    }

    core.setOutput('time', new Date().toTimeString());
  } catch (error) {
    if (error instanceof Error) core.setFailed(error.message);
  }
}

run();
