package content

import (
	"fmt"
	"io"
	"os"

	"line-cli-go/internal/client"
	"line-cli-go/internal/config"
	"line-cli-go/internal/output"

	"github.com/spf13/cobra"
)

var getCmd = &cobra.Command{
	Use:   "get",
	Short: "Download message content by message ID",
	RunE: func(cmd *cobra.Command, args []string) error {
		messageID, _ := cmd.Flags().GetString("message-id")
		outputPath, _ := cmd.Flags().GetString("output")

		if messageID == "" {
			return fmt.Errorf("--message-id is required")
		}
		p := output.NewPrinter(config.JSONMode(), nil)

		blobAPI, err := client.NewMessagingBlobAPI()
		if err != nil {
			return err
		}

		resp, err := blobAPI.GetMessageContent(messageID)
		if err != nil {
			p.Error(0, err.Error())
			return err
		}
		defer resp.Body.Close()

		if outputPath != "" {
			f, err := os.Create(outputPath)
			if err != nil {
				return fmt.Errorf("creating output file: %w", err)
			}
			defer f.Close()
			n, err := io.Copy(f, resp.Body)
			if err != nil {
				return fmt.Errorf("writing content: %w", err)
			}
			p.Success("Content saved", map[string]string{
				"file":  outputPath,
				"bytes": fmt.Sprintf("%d", n),
			})
		} else {
			if _, err := io.Copy(os.Stdout, resp.Body); err != nil {
				return fmt.Errorf("writing content to stdout: %w", err)
			}
		}
		return nil
	},
}

func init() {
	getCmd.Flags().String("message-id", "", "message ID (required)")
	getCmd.Flags().String("output", "", "save to file path (default: stdout)")
}
