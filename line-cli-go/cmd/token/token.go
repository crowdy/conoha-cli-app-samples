package token

import "github.com/spf13/cobra"

var TokenCmd = &cobra.Command{
	Use:   "token",
	Short: "Manage channel access tokens",
}

func init() {
	TokenCmd.AddCommand(issueCmd)
	TokenCmd.AddCommand(issueV3Cmd)
	TokenCmd.AddCommand(verifyCmd)
	TokenCmd.AddCommand(revokeCmd)
	TokenCmd.AddCommand(listKidsCmd)
}
