package batch

import (
	"line-cli-go/internal/client"
	"line-cli-go/internal/config"
	"line-cli-go/internal/output"
	"line-cli-go/internal/payload"

	"github.com/line/line-bot-sdk-go/v8/linebot/messaging_api"
	"github.com/spf13/cobra"
)

var submitCmd = &cobra.Command{
	Use:   "submit",
	Short: "Submit a batch operations request (202 async)",
	RunE: func(cmd *cobra.Command, args []string) error {
		payloadFile, _ := cmd.Flags().GetString("payload-file")
		var req messaging_api.RichMenuBatchRequest
		if err := payload.LoadJSON(payloadFile, &req); err != nil {
			return err
		}
		p := output.NewPrinter(config.JSONMode(), nil)
		api, err := client.NewMessagingAPI()
		if err != nil {
			return err
		}
		httpResp, _, err := api.RichMenuBatchWithHttpInfo(&req)
		if err != nil {
			p.Error(output.ExtractHTTPStatus(err), err.Error())
			return err
		}
		requestID := httpResp.Header.Get("X-Line-Request-Id")
		p.Raw(map[string]any{"requestId": requestID})
		return nil
	},
}

func init() {
	submitCmd.Flags().String("payload-file", "", "path to JSON payload (use '-' for stdin) (required)")
	BatchCmd.AddCommand(submitCmd)
}
