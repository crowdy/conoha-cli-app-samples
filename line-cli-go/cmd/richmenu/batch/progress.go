package batch

import (
	"line-cli-go/internal/client"
	"line-cli-go/internal/config"
	"line-cli-go/internal/output"

	"github.com/spf13/cobra"
)

var progressCmd = &cobra.Command{
	Use:   "progress",
	Short: "Get batch request progress (single-shot, not polling)",
	RunE: func(cmd *cobra.Command, args []string) error {
		requestID, _ := cmd.Flags().GetString("request-id")
		if requestID == "" {
			return &config.ClientError{Msg: "--request-id is required"}
		}
		p := output.NewPrinter(config.JSONMode(), nil)
		api, err := client.NewMessagingAPI()
		if err != nil {
			return err
		}
		resp, err := api.GetRichMenuBatchProgress(requestID)
		if err != nil {
			p.Error(output.ExtractHTTPStatus(err), err.Error())
			return output.Printed(err)
		}
		p.Raw(resp)
		return nil
	},
}

func init() {
	progressCmd.Flags().String("request-id", "", "batch request ID from the submit command (required)")
	_ = progressCmd.MarkFlagRequired("request-id")
	BatchCmd.AddCommand(progressCmd)
}
