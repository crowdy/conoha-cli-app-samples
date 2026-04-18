package webhook

import "github.com/spf13/cobra"

var WebhookCmd = &cobra.Command{
	Use:   "webhook",
	Short: "Manage webhook endpoint configuration",
}

func init() {
	WebhookCmd.AddCommand(getCmd)
	WebhookCmd.AddCommand(setCmd)
	WebhookCmd.AddCommand(testCmd)
}
